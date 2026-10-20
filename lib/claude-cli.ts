import { spawn } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 2_000_000
const MAX_CONCURRENT = 4
const MODEL = 'claude-sonnet-5-5'

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

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const append = (current: string, chunk: Buffer) =>
      Buffer.byteLength(current) >= MAX_OUTPUT_BYTES ? current : (current + chunk.toString('utf8')).slice(0, MAX_OUTPUT_BYTES)

    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
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
      resolve({ exitCode, stdout, stderr, timedOut })
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref()
    }, timeoutMs)
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
    if (error instanceof Error && error.message.includes('ENOENT')) {
      throw new ClaudeCliError('Claude CLI is not installed or not available on PATH for the Next.js process.', 503)
    }
    throw error
  } finally {
    active -= 1
  }
}
