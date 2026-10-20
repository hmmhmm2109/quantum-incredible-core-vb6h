import { spawn } from 'node:child_process'
import { authMiddleware } from 'lyzr-architect-pg'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 2_000_000

const SYSTEM_PROMPT = `You are the Embedded Systems Learning Coach for EmbedPath. Teach C, C++, Linux, Networking, and BSP with practice-first, evidence-based instruction.
Return valid JSON only, with no markdown fences. The JSON must have status, result, and metadata. result must include request_type, activity, feedback, hints, lecture, assessment, mastery_evidence, recommended_next_activity, learner_explanation, and claude_cli.
Use the exact field structure implied by the request. Preserve empty sections with null, zero, or empty arrays. Evaluate correctness, reasoning, tests, safety, and mastery independently. Use staged hints. Never award mastery for reading alone. Never claim production hardware safety without human review.
For claude_cli return available=true, status=completed, notice="Executed directly by Claude CLI using the Linux host OAuth session.", job_id=null, exit_code=0, stdout="", stderr="", changed_files=[].
Do not request credentials, do not invoke shell commands, and do not modify files.`

type CommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

function runClaude(message: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--output-format', 'json',
      '--tools', '',
      '--no-session-persistence',
      '--system-prompt', SYSTEM_PROMPT,
      message,
    ]
    const child = spawn('claude', args, {
      cwd: process.cwd(),
      shell: false,
      env: {
        ...process.env,
        LANG: process.env.LANG || 'C.UTF-8',
        TERM: 'dumb',
        NO_COLOR: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdin.end()

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const append = (current: string, chunk: Buffer) => {
      if (Buffer.byteLength(current) >= MAX_OUTPUT_BYTES) return current
      return (current + chunk.toString('utf8')).slice(0, MAX_OUTPUT_BYTES)
    }

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
    }, TIMEOUT_MS)
  })
}

function parseJsonText(value: string): unknown {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(cleaned)
}

function extractClaudeResult(stdout: string): unknown {
  const outer = parseJsonText(stdout)
  if (outer && typeof outer === 'object' && !Array.isArray(outer)) {
    const record = outer as Record<string, unknown>
    if (typeof record.result === 'string') return parseJsonText(record.result)
    if (record.result && typeof record.result === 'object') return record.result
  }
  return outer
}

export const POST = authMiddleware(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message) return NextResponse.json({ success: false, error: 'message is required' }, { status: 400 })
    if (message.length > 100_000) return NextResponse.json({ success: false, error: 'message is too large' }, { status: 413 })

    const command = await runClaude(message)
    if (command.timedOut) {
      return NextResponse.json({ success: false, error: 'Claude CLI timed out', stderr: command.stderr }, { status: 504 })
    }
    if (command.exitCode !== 0) {
      return NextResponse.json({ success: false, error: 'Claude CLI failed', exit_code: command.exitCode, stderr: command.stderr }, { status: 502 })
    }

    const parsed = extractClaudeResult(command.stdout)
    if (!parsed || typeof parsed !== 'object') {
      return NextResponse.json({ success: false, error: 'Claude CLI returned an invalid structured response' }, { status: 502 })
    }

    const envelope = parsed as Record<string, unknown>
    const result = envelope.status && envelope.result ? envelope.result : parsed
    const metadata = envelope.metadata && typeof envelope.metadata === 'object'
      ? envelope.metadata
      : { agent_name: 'Embedded Systems Learning Coach via Claude CLI', timestamp: new Date().toISOString(), request_id: null }

    return NextResponse.json({
      success: true,
      response: {
        status: envelope.status === 'error' ? 'error' : 'success',
        result,
        message: typeof envelope.message === 'string' ? envelope.message : undefined,
        metadata,
      },
      runtime: 'claude-cli-oauth',
    })
  } catch (error) {
    const message = error instanceof Error
      ? error.message.includes('ENOENT') ? 'Claude CLI is not installed or not available on PATH for the Next.js process.' : error.message
      : 'Claude CLI execution failed'
    return NextResponse.json({ success: false, error: message }, { status: 503 })
  }
})
