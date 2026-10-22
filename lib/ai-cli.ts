import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCurrentUserId } from 'lyzr-architect-pg'
import { rateLimit } from '@/lib/rate-limit'
import { validateJsonSchema } from '@/lib/json-schema-lite'
import { copilotBin, getAiSettings, otherProvider, type AiProvider, type AiSettings } from '@/lib/ai-settings'

// One entry point for every AI call: `runClaudeJson` picks the active provider (Claude CLI or Copilot CLI) per call.
// Shared here: rate limit, concurrency cap, spawn logging, error mapping, timeouts, optional per-call failover.

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 2_000_000
const COPILOT_MAX_OUTPUT_BYTES = 4_000_000
// Linux caps a single argv string at 128 KiB; Copilot takes the whole prompt as one `-p` argument.
const COPILOT_MAX_PROMPT_BYTES = 120_000
const MAX_CONCURRENT = 4
const MAX_SPAWNS_PER_MINUTE = 30
export const CLAUDE_MODEL = 'claude-sonnet-5-5'

let active = 0

/** quota: limit/rate limit hit; auth: not logged in; missing: binary not found. Only these can trigger failover. */
export type AiErrorKind = 'quota' | 'auth' | 'missing'

export class ClaudeCliError extends Error {
  status: number
  kind?: AiErrorKind
  constructor(message: string, status = 502, kind?: AiErrorKind) {
    super(message)
    this.status = status
    this.kind = kind
  }
}

export type { AiProvider } from '@/lib/ai-settings'

export type RunOptions = {
  systemPrompt: string
  message: string
  jsonSchema?: object
  timeoutMs?: number
  /** Which route or step started this call; logged with duration and exit code. */
  purpose?: string
  /** Force one provider for this call (no failover). Used by the settings "Test connection" button. */
  provider?: AiProvider
}

export const providerName = (provider: AiProvider) => (provider === 'claude' ? 'Claude CLI' : 'Copilot CLI')

/** Value stored in topic_lessons.model. */
export function modelLabel(provider: AiProvider): string {
  return provider === 'claude' ? CLAUDE_MODEL : `copilot:${copilotModel() ?? 'auto'}`
}

function copilotModel(): string | null {
  const value = (process.env.COPILOT_MODEL ?? '').trim()
  return /^[A-Za-z0-9][\w.:-]*$/.test(value) ? value : null
}

// Which provider produced a returned object, so callers can record it without a signature change.
const servedBy = new WeakMap<object, string>()
export const servedModel = (result: unknown): string =>
  (result && typeof result === 'object' ? servedBy.get(result) : undefined) ?? modelLabel('claude')

type CommandResult = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }

function spawnCommand(bin: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; maxBytes: number; detached?: boolean }): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, shell: false, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'], detached: opts.detached === true })
    child.stdin.end()

    // Output is collected as Buffers and capped by bytes; decoding happens once at the end,
    // so a multibyte character is never cut in the middle by the cap.
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let timedOut = false

    // A detached child leads its own process group; killing -pid also takes down anything it forked.
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (opts.detached && child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch { /* already gone */ }
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill('SIGTERM')
      setTimeout(() => kill('SIGKILL'), 2_000).unref()
    }, opts.timeoutMs)

    const collect = (chunks: Buffer[], used: number, chunk: Buffer) => {
      const room = opts.maxBytes - used
      if (room <= 0) return 0
      const kept = chunk.length > room ? chunk.subarray(0, room) : chunk
      chunks.push(kept)
      return kept.length
    }
    // Decoding a Buffer cut mid-character yields U+FFFD at the end only; drop it.
    const decode = (chunks: Buffer[]) => Buffer.concat(chunks).toString('utf8').replace(/�$/, '')

    child.stdout.on('data', (chunk: Buffer) => { stdoutBytes += collect(stdout, stdoutBytes, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderrBytes += collect(stderr, stderrBytes, chunk) })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    // Settle on the real exit, never merely because the timer fired.
    child.on('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ exitCode, stdout: decode(stdout), stderr: decode(stderr), timedOut })
    })
  })
}

function parseJsonText(value: string): unknown {
  return JSON.parse(value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
}

/** Like parseJsonText, but also accepts prose around a single JSON object (Copilot has no schema mode). */
function parseModelJson(value: string): unknown {
  try { return parseJsonText(value) } catch (first) {
    const start = value.indexOf('{')
    const end = value.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1))
    throw first
  }
}

/** Classifies provider failure text (stderr, error events, is_error results). Never fed with model answers. */
function classifyText(text: string, status?: number, code?: string): AiErrorKind | undefined {
  if (status === 402 || status === 429 || (code && /quota|rate.?limit|too_many/i.test(code))) return 'quota'
  if (/usage limit|quota|rate.?limit|too many requests|credit balance|premium request|\b429\b|overloaded/i.test(text)) return 'quota'
  if (status === 401 || status === 403 || /no authentication information|not authenticated|not logged in|please (?:run|use) .{0,20}login|copilot login|\/login|unauthori[sz]ed|bad credentials|invalid api key|oauth token|\b401\b/i.test(text)) return 'auth'
  return undefined
}

function mappedError(provider: AiProvider, kind: AiErrorKind | undefined, fallback: string, status = 502): ClaudeCliError {
  if (kind === 'quota') return new ClaudeCliError(provider === 'copilot' ? 'Copilot quota exhausted (or rate limited). Try again later or switch provider.' : 'Claude usage limit reached. Try again later or switch provider.', 429, 'quota')
  if (kind === 'auth') {
    return new ClaudeCliError(provider === 'copilot' ? 'Copilot is not logged in: run copilot login or set COPILOT_GITHUB_TOKEN' : 'Claude CLI is not logged in: run claude and sign in on the host.', 503, 'auth')
  }
  return new ClaudeCliError(fallback, status)
}

const missing = (provider: AiProvider) => new ClaudeCliError(
  provider === 'copilot' ? 'copilot CLI not found. Install it and put it on PATH for the Next.js process.' : 'Claude CLI is not installed or not available on PATH for the Next.js process.',
  503,
  'missing',
)

// ---------------------------------------------------------------- Claude provider

async function runClaudeProvider({ systemPrompt, message, jsonSchema, timeoutMs = DEFAULT_TIMEOUT_MS }: RunOptions, onOutcome: (outcome: string) => void): Promise<unknown> {
  const args = ['--print', '--output-format', 'json', '--model', CLAUDE_MODEL, '--tools', '', '--no-session-persistence', '--system-prompt', systemPrompt]
  if (jsonSchema) args.push('--json-schema', JSON.stringify(jsonSchema))
  // `--` stops a message that starts with "-" from being parsed as a flag.
  args.push('--', message)
  const command = await spawnCommand('claude', args, {
    cwd: process.cwd(),
    env: { ...process.env, LANG: process.env.LANG || 'C.UTF-8', TERM: 'dumb', NO_COLOR: '1' },
    timeoutMs,
    maxBytes: MAX_OUTPUT_BYTES,
  })
  onOutcome(command.timedOut ? 'timeout' : `exit ${command.exitCode}`)
  if (command.timedOut) throw new ClaudeCliError('Claude CLI timed out', 504)
  if (command.exitCode !== 0) {
    console.error('[claude-cli] exit', command.exitCode, command.stderr.slice(0, 2000))
    throw mappedError('claude', classifyText(`${command.stderr}\n${command.stdout.slice(0, 2000)}`), 'Claude CLI failed')
  }

  let outer: unknown
  try { outer = parseJsonText(command.stdout) } catch { throw new ClaudeCliError('Claude CLI returned unreadable output', 502) }
  const record = outer && typeof outer === 'object' && !Array.isArray(outer) ? (outer as Record<string, unknown>) : null
  if (!record) throw new ClaudeCliError('Claude CLI returned an invalid structured response', 502)

  if (record.is_error === true) {
    const detail = String(record.result ?? '')
    console.error('[claude-cli] is_error', detail.slice(0, 500))
    throw mappedError('claude', classifyText(detail), 'Claude CLI reported an error (is it logged in?)')
  }
  if (record.structured_output && typeof record.structured_output === 'object') return record.structured_output
  if (typeof record.result === 'string') {
    try { return parseJsonText(record.result) } catch { throw new ClaudeCliError('Claude CLI did not return valid JSON', 502) }
  }
  if (record.result && typeof record.result === 'object') return record.result
  throw new ClaudeCliError('Claude CLI returned an empty response', 502)
}

// ---------------------------------------------------------------- Copilot provider

/** Copilot has no --system-prompt or --json-schema: everything goes into one prompt. Never starts with "-". */
export function composeCopilotPrompt({ systemPrompt, message, jsonSchema }: Pick<RunOptions, 'systemPrompt' | 'message' | 'jsonSchema'>): string {
  const parts = [
    'You are answering one non-interactive request. Do not use tools or ask questions. The INSTRUCTIONS section is your system prompt; the REQUEST section is the user message.',
    `=== INSTRUCTIONS ===\n${systemPrompt}`,
    `=== REQUEST ===\n${message}`,
  ]
  if (jsonSchema) parts.push(`=== OUTPUT FORMAT ===\nReturn ONLY a single JSON object matching this JSON Schema: ${JSON.stringify(jsonSchema)}\nNo prose before or after it and no code fences.`)
  else parts.push('=== OUTPUT FORMAT ===\nReturn ONLY a single JSON object. No prose and no code fences.')
  return parts.join('\n\n')
}

type CopilotEvent = { status?: number; code?: string; message: string }
type CopilotParsed = { text: string | null; errors: CopilotEvent[]; jsonLines: number }

/** Tolerant JSONL reader: last full assistant message wins, deltas are a fallback, error events are collected. */
export function parseCopilotOutput(stdout: string): CopilotParsed {
  let text: string | null = null
  let deltas = ''
  let jsonLines = 0
  const errors: CopilotEvent[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('{')) continue
    let event: Record<string, unknown>
    try { event = JSON.parse(line) as Record<string, unknown> } catch { continue }
    // Only objects with a string `type` are CLI events; a bare JSON answer on stdout is not.
    if (typeof event.type !== 'string') continue
    jsonLines += 1
    const type = event.type
    const data = event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : event
    const content = typeof data.content === 'string' ? data.content : typeof event.content === 'string' ? event.content : null
    if (type === 'assistant.message' || (event.role === 'assistant' && type === '')) {
      if (content && content.trim()) { text = content; deltas = '' }
    } else if (/delta/i.test(type) && /assistant/i.test(type)) {
      deltas += String(data.deltaContent ?? data.content ?? '')
    } else if (type === 'result' && typeof event.result === 'string' && !text) {
      text = event.result
    }
    const status = Number(data.statusCode ?? event.statusCode)
    const code = data.errorCode ?? event.errorCode
    if (/error|failure|fail/i.test(type) || code !== undefined) {
      errors.push({ status: Number.isFinite(status) ? status : undefined, code: code === undefined ? undefined : String(code), message: String(data.message ?? data.error ?? event.message ?? '') })
    }
  }
  if (!text && deltas.trim()) text = deltas
  return { text, errors, jsonLines }
}

async function copilotCall(prompt: string, timeoutMs: number, onOutcome: (outcome: string) => void): Promise<string> {
  if (Buffer.byteLength(prompt) > COPILOT_MAX_PROMPT_BYTES) throw new ClaudeCliError('Request is too large for Copilot CLI (prompt exceeds the argument size limit)', 502)
  const args = ['-p', prompt, '--output-format', 'json', '--available-tools=none', '--disable-builtin-mcps', '--no-custom-instructions', '--no-ask-user', '--allow-all-tools', '--no-auto-update']
  const model = copilotModel()
  if (model) args.push('--model', model)
  const env: NodeJS.ProcessEnv = { ...process.env, LANG: process.env.LANG || 'C.UTF-8', TERM: 'dumb', NO_COLOR: '1' }
  if (process.env.COPILOT_HOME_DIR) env.COPILOT_HOME = process.env.COPILOT_HOME_DIR
  // Empty cwd: even if tools were somehow available there is nothing to read or edit.
  const cwd = await mkdtemp(join(tmpdir(), 'embedpath-copilot-'))
  try {
    const command = await spawnCommand(copilotBin(), args, { cwd, env, timeoutMs, maxBytes: COPILOT_MAX_OUTPUT_BYTES, detached: true })
    onOutcome(command.timedOut ? 'timeout' : `exit ${command.exitCode}`)
    if (command.timedOut) throw new ClaudeCliError('Copilot CLI timed out', 504)
    const parsed = parseCopilotOutput(command.stdout)
    // Plain text output (no JSONL at all): use stdout as the answer.
    const text = parsed.text ?? (parsed.jsonLines === 0 && command.exitCode === 0 && command.stdout.trim() ? command.stdout.trim() : null)
    if (command.exitCode === 0 && text) return text
    for (const event of parsed.errors) {
      const kind = classifyText(event.message, event.status, event.code)
      if (kind) { console.error('[copilot-cli] error event', event.code, event.status, event.message.slice(0, 300)); throw mappedError('copilot', kind, '') }
    }
    const stderrKind = classifyText(command.stderr)
    if (stderrKind) { console.error('[copilot-cli] stderr', command.stderr.slice(0, 500)); throw mappedError('copilot', stderrKind, '') }
    console.error('[copilot-cli] exit', command.exitCode, command.stderr.slice(0, 1000), command.stdout.slice(-1000))
    throw new ClaudeCliError(command.exitCode === 0 ? 'Copilot CLI returned an empty response' : 'Copilot CLI failed', 502)
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined)
  }
}

function checkCopilotAnswer(text: string, jsonSchema: object | undefined): { value: unknown; problems: string[] } {
  let value: unknown
  try { value = parseModelJson(text) } catch { return { value: null, problems: ['The reply was not valid JSON.'] } }
  if (!jsonSchema) return { value, problems: [] }
  return { value, problems: validateJsonSchema(value, jsonSchema) }
}

async function runCopilotProvider(options: RunOptions, onOutcome: (outcome: string) => void): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const prompt = composeCopilotPrompt(options)
  const first = await copilotCall(prompt, timeoutMs, onOutcome)
  const firstCheck = checkCopilotAnswer(first, options.jsonSchema)
  if (firstCheck.problems.length === 0) return firstCheck.value

  // One repair attempt with the concrete problems appended.
  console.warn('[copilot-cli] invalid output, repairing once:', firstCheck.problems.slice(0, 5).join('; '))
  const repair = `${prompt}\n\n=== YOUR PREVIOUS REPLY WAS REJECTED ===\nProblems:\n${firstCheck.problems.map((problem) => `- ${problem}`).join('\n')}\nPrevious reply (truncated):\n${first.slice(0, 3000)}\n\nReturn ONLY the corrected single JSON object.`
  const second = await copilotCall(repair, timeoutMs, onOutcome)
  const secondCheck = checkCopilotAnswer(second, options.jsonSchema)
  if (secondCheck.problems.length === 0) return secondCheck.value
  console.error('[copilot-cli] still invalid after repair:', secondCheck.problems.slice(0, 5).join('; '))
  throw new ClaudeCliError('Copilot CLI did not return JSON matching the expected schema', 502)
}

// ---------------------------------------------------------------- entry point

async function runProvider(provider: AiProvider, options: RunOptions): Promise<unknown> {
  const startedAt = Date.now()
  let outcome = 'error'
  try {
    const result = provider === 'copilot' ? await runCopilotProvider(options, (o) => { outcome = o }) : await runClaudeProvider(options, (o) => { outcome = o })
    if (result && typeof result === 'object') servedBy.set(result, modelLabel(provider))
    return result
  } catch (error) {
    if (error instanceof ClaudeCliError) throw error
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') throw missing(provider)
    throw error
  } finally {
    console.info(`[claude-cli] provider=${provider} purpose=${options.purpose ?? 'unknown'} duration_ms=${Date.now() - startedAt} result=${outcome}`)
  }
}

/**
 * Runs the active AI CLI once and returns its structured JSON answer. The provider comes from the learner's
 * setting (see lib/ai-settings.ts). Errors carry an HTTP status and a message that is safe to show to the client;
 * stderr stays in the server log. With the failover setting on, a quota/auth/not-installed error is retried once
 * on the other provider (per call, nothing persisted).
 */
export async function runClaudeJson(options: RunOptions): Promise<unknown> {
  // One budget per learner, counted where a CLI is actually spawned, so cached lessons and replayed grades cost nothing.
  const budget = rateLimit(`claude:${getCurrentUserId() ?? 'anonymous'}`, MAX_SPAWNS_PER_MINUTE, 60_000)
  if (!budget.ok) throw new ClaudeCliError(`Too many requests. Try again in ${budget.retryAfterSeconds}s.`, 429)
  if (active >= MAX_CONCURRENT) throw new ClaudeCliError('The tutor is busy. Try again in a moment.', 429)
  active += 1
  try {
    const settings = options.provider ? { provider: options.provider, failover: false } : await getAiSettings()
    return await runWithSettings(settings, options)
  } finally {
    active -= 1
  }
}

/** Runs on `settings.provider`; with `settings.failover`, a quota/auth/missing error is retried once on the other provider. */
export async function runWithSettings(settings: AiSettings, options: RunOptions): Promise<unknown> {
  try {
    return await runProvider(settings.provider, options)
  } catch (error) {
    if (!settings.failover || !(error instanceof ClaudeCliError) || !error.kind) throw error
    const alternate = otherProvider(settings.provider)
    console.warn(`[claude-cli] failover purpose=${options.purpose ?? 'unknown'} from=${settings.provider} to=${alternate} reason=${error.kind}`)
    try {
      return await runProvider(alternate, options)
    } catch (second) {
      const detail = second instanceof Error ? second.message : 'failed'
      throw new ClaudeCliError(`${error.message} (fallback to ${providerName(alternate)} also failed: ${detail})`, error.status, error.kind)
    }
  }
}
