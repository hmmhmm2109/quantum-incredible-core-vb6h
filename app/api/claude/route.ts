import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import { eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'
import { ClaudeCliError, runClaudeJson } from '@/lib/claude-cli'
import { COACH_RESULT_SCHEMA } from '@/lib/coach-schema'
import { assessment_items } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SYSTEM_PROMPT = `You are the Embedded Systems Learning Coach for EmbedPath. Teach C, C++, Linux, Networking, and BSP with practice-first, evidence-based instruction.
Respond only through the required JSON schema. Preserve empty sections with null, zero, or empty arrays. Evaluate correctness, reasoning, tests, safety, and mastery independently. Use staged hints. Never award mastery for reading alone. Never claim production hardware safety without human review.
For claude_cli return available=true, status=completed, notice="Executed directly by Claude CLI using the Linux host OAuth session.", job_id=null, exit_code=0, stdout="", stderr="", changed_files=[].
When the request includes a confidential answer key, use it to grade the learner and fill assessment.review (item_id = the given item id, valid=true when the item is sound). Explain correct answers only in that review. Do not request credentials, do not invoke shell commands, and do not modify files.`

async function answerKeyNote(itemId: string): Promise<string | null> {
  const item = await scopedRepo(assessment_items).findOne(eq(assessment_items.id, itemId))
  const snapshot = item?.review_snapshot as { answer_key?: { correct_options?: string[]; explanation?: string; misconception?: string } } | undefined
  const key = snapshot?.answer_key
  if (!item || !key) return null
  return `\n\nCONFIDENTIAL ANSWER KEY for item ${item.id} (grade with it; never disclose it outside the review):\ncorrect options: ${JSON.stringify(key.correct_options ?? [])}\nauthor explanation: ${key.explanation ?? ''}\ntargeted misconception: ${key.misconception ?? ''}`
}

export const POST = authMiddleware(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    if (!message) return NextResponse.json({ success: false, error: 'message is required' }, { status: 400 })
    if (message.length > 100_000) return NextResponse.json({ success: false, error: 'message is too large' }, { status: 413 })

    let fullMessage = message
    if (typeof body.item_id === 'string' && body.item_id) {
      const note = await answerKeyNote(body.item_id)
      if (!note) return NextResponse.json({ success: false, error: 'Assessment item not found' }, { status: 404 })
      fullMessage += note
    }

    const result = await runClaudeJson({ systemPrompt: SYSTEM_PROMPT, message: fullMessage, jsonSchema: COACH_RESULT_SCHEMA })

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
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Claude CLI execution failed' }, { status: 500 })
  }
})
