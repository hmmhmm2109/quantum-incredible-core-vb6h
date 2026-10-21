import { spawn } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 2_000_000
const MAX_CONCURRENT = 4
export const MODEL = 'claude-sonnet-5-5'

let active = 0

export class ClaudeCliError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}

type RunOptions = {
  systemPrompt: string
  message: string
  jsonSchema?: object
  timeoutMs?: number
}

type CommandResult = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }

function spawnClaude({ systemPrompt, message, jsonSchema, timeoutMs = DEFAULT_TIMEOUT_MS }: RunOptions): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const args = ['--print', '--output-format', 'json', '--model', MODEL, '--tools', '', '--no-session-persistence', '--system-prompt', systemPrompt]
    if (jsonSchema) args.push('--json-schema', JSON.stringify(jsonSchema))
    // `--` stops a message that starts with "-" from being parsed as a flag.
    args.push('--', message)

    const child = spawn('claude', args, {
      cwd: process.cwd(),
      shell: false,
      env: { ...process.env, LANG: process.env.LANG || 'C.UTF-8', TERM: 'dumb', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdin.end()

    // Output is collected as Buffers and capped by bytes; decoding happens once at the end,
    // so a multibyte character is never cut in the middle by the cap.
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref()
    }, timeoutMs)

    const collect = (chunks: Buffer[], used: number, chunk: Buffer) => {
      const room = MAX_OUTPUT_BYTES - used
      if (room <= 0) return 0
      const kept = chunk.length > room ? chunk.subarray(0, room) : chunk
      chunks.push(kept)
      return kept.length
    }
    // Decoding a Buffer cut mid-character yields U+FFFD at the end only; drop it.
    const decode = (chunks: Buffer[]) => Buffer.concat(chunks).toString('utf8').replace(/\uFFFD$/, '')

    child.stdout.on('data', (chunk: Buffer) => { stdoutBytes += collect(stdout, stdoutBytes, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderrBytes += collect(stderr, stderrBytes, chunk) })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
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

/**
 * Runs Claude CLI once and returns its structured JSON answer. With `jsonSchema`
 * the CLI validates the output and returns it as `structured_output`.
 * Errors carry an HTTP status and a message that is safe to show to the client;
 * stderr stays in the server log.
 */
export async function runClaudeJson(options: RunOptions): Promise<unknown> {
  if (active >= MAX_CONCURRENT) throw new ClaudeCliError('The tutor is busy. Try again in a moment.', 429)
  active += 1
  try {
    const command = await spawnClaude(options)
    if (command.timedOut) throw new ClaudeCliError('Claude CLI timed out', 504)
    if (command.exitCode !== 0) {
      console.error('[claude-cli] exit', command.exitCode, command.stderr.slice(0, 2000))
      throw new ClaudeCliError('Claude CLI failed', 502)
    }

    let outer: unknown
    try { outer = parseJsonText(command.stdout) } catch { throw new ClaudeCliError('Claude CLI returned unreadable output', 502) }
    const record = outer && typeof outer === 'object' && !Array.isArray(outer) ? (outer as Record<string, unknown>) : null
    if (!record) throw new ClaudeCliError('Claude CLI returned an invalid structured response', 502)

    if (record.is_error === true) {
      console.error('[claude-cli] is_error', String(record.result ?? '').slice(0, 500))
      throw new ClaudeCliError('Claude CLI reported an error (is it logged in?)', 502)
    }
    if (record.structured_output && typeof record.structured_output === 'object') return record.structured_output
    if (typeof record.result === 'string') {
      try { return parseJsonText(record.result) } catch { throw new ClaudeCliError('Claude CLI did not return valid JSON', 502) }
    }
    if (record.result && typeof record.result === 'object') return record.result
    throw new ClaudeCliError('Claude CLI returned an empty response', 502)
  } catch (error) {
    if (error instanceof ClaudeCliError) throw error
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
      throw new ClaudeCliError('Claude CLI is not installed or not available on PATH for the Next.js process.', 503)
    }
    throw error
  } finally {
    active -= 1
  }
}
