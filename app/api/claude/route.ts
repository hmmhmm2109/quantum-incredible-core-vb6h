import { authMiddleware } from 'lyzr-architect-pg'
import { NextRequest, NextResponse } from 'next/server'
import { ClaudeCliError, runClaudeJson } from '@/lib/claude-cli'
import { COACH_RESULT_SCHEMA } from '@/lib/coach-schema'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SYSTEM_PROMPT = `You are the Embedded Systems Learning Coach for EmbedPath. Use a lesson-first learning flow by default: theory explanation, guided worked example, retrieval check, then focused practice. Teach C, C++, Linux, Networking, and BSP with evidence-based instruction.
Respond only through the required JSON schema. Preserve empty sections with null, zero, or empty arrays. When domain_id and topic_id are supplied with selected_topic_only=true, never mix content, questions, scoring, or mastery evidence from another topic except clearly labeled prerequisites. Evaluate correctness, reasoning, tests, safety, and mastery independently. Use staged hints. Never award mastery for reading alone. Never claim production hardware safety without human review.
For claude_cli return available=true, status=completed, notice="Executed directly by Claude CLI using the Linux host OAuth session.", job_id=null, exit_code=0, stdout="", stderr="", changed_files=[].
Do not request credentials, do not invoke shell commands, and do not modify files.`

export const POST = authMiddleware(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message) return NextResponse.json({ success: false, error: 'message is required' }, { status: 400 })
    if (message.length > 100_000) return NextResponse.json({ success: false, error: 'message is too large' }, { status: 413 })

    const result = await runClaudeJson({ systemPrompt: SYSTEM_PROMPT, message, jsonSchema: COACH_RESULT_SCHEMA, purpose: 'api/claude' })

    return NextResponse.json({
      success: true,
      response: {
        status: 'success',
        result,
        metadata: { agent_name: 'Embedded Systems Learning Coach via Claude CLI', timestamp: new Date().toISOString(), request_id: null },
      },
      runtime: 'claude-cli-oauth',
    })
  } catch (error) {
    if (error instanceof ClaudeCliError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[API] POST /api/claude error:', error)
    return NextResponse.json({ success: false, error: 'Claude CLI execution failed' }, { status: 500 })
  }
})
