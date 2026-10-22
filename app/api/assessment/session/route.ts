import { authMiddleware, getCurrentUserId, getDb } from 'lyzr-architect-pg'
import { and, eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'
import { assessment_items, assessment_responses, assessment_sessions } from '@/lib/db/schema'
import { deriveSelection, outcomeOf, planLength, RETAKE_MODE, sessionTitle, topicName, topicsOf } from '@/lib/assessment-history'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/assessment/session?id=<session id> -> everything needed to REVIEW a session.
// Redaction guarantee: an item without a stored response (unanswered) is built from the public fields only (the same ones stripAnswerKey() in
// lib/assessment-redact.ts leaves in the browser's reach) and carries no
// correct answer, explanation, misconception or difficulty rationale, even when the session is completed or abandoned.
// Another learner's session id (or an unknown one) is a 404, exactly like a missing one.
type AnswerKey = { correct_options?: string[]; explanation?: string; misconception?: string }

export const GET = authMiddleware(async (request: NextRequest) => {
  try {
    const ownerId = getCurrentUserId()
    if (!ownerId) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    const db = getDb()
    const [session] = await db.select().from(assessment_sessions).where(and(eq(assessment_sessions.owner_user_id, ownerId), eq(assessment_sessions.id, id))).limit(1)
    if (!session) return NextResponse.json({ success: false, error: 'Assessment session not found' }, { status: 404 })
    const rows = await db.select().from(assessment_items).where(and(eq(assessment_items.owner_user_id, ownerId), eq(assessment_items.session_id, id)))
    const responses = await db.select().from(assessment_responses).where(and(eq(assessment_responses.owner_user_id, ownerId), eq(assessment_responses.session_id, id))).orderBy(assessment_responses.created_at)
    const byItem = new Map(responses.map((response) => [response.item_id, response]))

    const slotOf = (row: (typeof rows)[number]) => Number((row.generated_question as { slot?: number }).slot ?? 0)
    const questions = rows.sort((a, b) => slotOf(a) - slotOf(b)).map((row) => {
      const q = row.generated_question as { slot?: number; stem?: string; artifact?: string | null; options?: string[]; type?: string; domain_id?: string; topic_id?: string; topic?: string }
      const response = byItem.get(row.id)
      const base = {
        item_id: row.id, slot: slotOf(row), type: q.type ?? 'single_answer', stem: q.stem ?? '', artifact: q.artifact ?? null, options: q.options ?? [],
        domain_id: q.domain_id ?? '', topic_id: q.topic_id ?? '', topic_name: topicName(q.domain_id ?? '', q.topic_id ?? ''), subtopic: q.topic ?? '',
        difficulty: Number((row.difficulty_factors as { score?: number })?.score ?? 0) || null,
      }
      if (!response) return { ...base, answered: false as const } // nothing else: the key stays on the server
      const key = (row.review_snapshot as { answer_key?: AnswerKey } | undefined)?.answer_key ?? {}
      const feedback = response.feedback as { mastery_delta?: unknown; feedback?: { correctness?: { confidence?: number } } }
      return {
        ...base, answered: true as const,
        selected_answers: (response.selected_answers as string[]) ?? [], correct_answers: key.correct_options ?? [],
        outcome: outcomeOf(Number(response.partial_credit)), partial_credit: Number(response.partial_credit),
        explanation: key.explanation ?? '', misconception: key.misconception ?? null,
        difficulty_rationale: (row.difficulty_factors as { factors?: string[] })?.factors ?? [],
        confidence: feedback.feedback?.correctness?.confidence ?? null, justification: response.justification || null,
        answered_at: new Date(response.created_at).toISOString(), response_time_ms: response.response_time_ms || null,
        mastery_delta: session.mode !== RETAKE_MODE ? feedback.mastery_delta ?? null : null,
      }
    })

    const topics = topicsOf(session.topic_coverage)
    const selection = deriveSelection(session.mode, session.timing_policy, topics)
    const answered = questions.filter((question) => question.answered)
    const correct = answered.filter((question) => question.answered && question.outcome === 'correct').length
    return NextResponse.json({
      success: true,
      data: {
        session_id: session.id, mode: session.mode, selection, title: sessionTitle(session.mode, selection, topics), topics,
        status: session.status === 'completed' ? 'completed' : session.status === 'abandoned' ? 'abandoned' : 'in_progress',
        started_at: new Date(session.created_at).toISOString(), question_count: planLength(session.timing_policy) || questions.length,
        answered_count: answered.length, correct_count: correct, score_pct: answered.length ? Math.round(answered.reduce((sum, question) => sum + (question.answered ? question.partial_credit : 0), 0) / answered.length * 100) : null,
        retake_of: (session.timing_policy as { retake_of?: string })?.retake_of ?? null,
        questions,
      },
    })
  } catch (error) {
    console.error('[API] GET /api/assessment/session error:', error)
    return NextResponse.json({ success: false, error: 'Unable to load this assessment' }, { status: 500 })
  }
})
