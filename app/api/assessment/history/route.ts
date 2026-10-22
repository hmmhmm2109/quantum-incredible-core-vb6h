import { authMiddleware, getCurrentUserId, getDb } from 'lyzr-architect-pg'
import { and, desc, eq, inArray, sql } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'
import { assessment_items, assessment_responses, assessment_sessions, learning_events } from '@/lib/db/schema'
import { deriveSelection, normalizeStatus, planLength, RETAKE_MODE, sessionTitle, topicName, topicsOf, type HistorySession, type MasteryChange } from '@/lib/assessment-history'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/assessment/history?limit=20&cursor=<created_at of the last row of the previous page>
// Every assessment session of the signed-in learner, newest first (mixed diagnostic, single topic, custom picker, retries), with
// counts, score and the mastery movement it caused. Only aggregates: no question text and no answer key (see /api/assessment/session).
// Abandoned sessions appear only when the learner had answered something in them; seed placeholders (no plan) never appear.
type MasteryDelta = { before?: number; after?: number; delta?: number; band_before?: string; band_after?: string }

export const GET = authMiddleware(async (request: NextRequest) => {
  try {
    const ownerId = getCurrentUserId()
    if (!ownerId) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    const params = new URL(request.url).searchParams
    const limit = Math.max(1, Math.min(100, Number.parseInt(params.get('limit') ?? '20', 10) || 20))
    const cursor = params.get('cursor')
    if (cursor && Number.isNaN(Date.parse(cursor))) return NextResponse.json({ success: false, error: 'cursor must be an ISO timestamp' }, { status: 400 })

    const db = getDb()
    // Fetch generously: placeholder and empty abandoned rows are dropped after the query, so a page can need more than `limit` rows.
    const where = and(eq(assessment_sessions.owner_user_id, ownerId), ...(cursor ? [sql`date_trunc('milliseconds', ${assessment_sessions.created_at}) < ${new Date(cursor)}`] : []))
    const rows = await db.select().from(assessment_sessions).where(where).orderBy(desc(assessment_sessions.created_at)).limit(limit * 3 + 1)
    const ids = rows.map((row) => row.id)
    const responses = ids.length ? await db.select().from(assessment_responses).where(and(eq(assessment_responses.owner_user_id, ownerId), inArray(assessment_responses.session_id, ids))).orderBy(assessment_responses.created_at) : []
    const items = ids.length ? await db.select({ id: assessment_items.id, session_id: assessment_items.session_id, q: assessment_items.generated_question }).from(assessment_items).where(and(eq(assessment_items.owner_user_id, ownerId), inArray(assessment_items.session_id, ids))) : []
    const itemTopic = new Map(items.map((item) => [item.id, item.q as { domain_id?: string; topic_id?: string }]))

    // Fallback for responses graded before the grade route stamped mastery_delta into the response: the learning event of the item.
    const unstamped = responses.filter((response) => !(response.feedback as { mastery_delta?: unknown })?.mastery_delta).map((response) => response.item_id)
    const events = unstamped.length ? await db.select().from(learning_events).where(and(eq(learning_events.owner_user_id, ownerId), eq(learning_events.event_type, 'assessment'), inArray(sql`${learning_events.evidence}->>'item_id'`, unstamped))) : []
    const eventDelta = new Map(events.map((event) => [String((event.evidence as { item_id?: string }).item_id), Number(event.score_delta)]))

    const sessions: HistorySession[] = []
    let lastRow: (typeof rows)[number] | null = null
    for (const row of rows) {
      if (sessions.length >= limit) break
      lastRow = row
      const own = responses.filter((response) => response.session_id === row.id)
      const plan = planLength(row.timing_policy)
      const status = normalizeStatus(row.status)
      if ((plan === 0 && own.length === 0) || (status === 'abandoned' && own.length === 0)) continue
      const topics = topicsOf(row.topic_coverage)
      const selection = deriveSelection(row.mode, row.timing_policy, topics)
      const answered = new Set(own.map((response) => response.item_id)).size
      const credit = own.reduce((sum, response) => sum + Number(response.partial_credit), 0)
      const changes = new Map<string, MasteryChange>()
      if (row.mode !== RETAKE_MODE) {
        for (const response of own) {
          const stamp = (response.feedback as { mastery_delta?: MasteryDelta })?.mastery_delta
          const q = itemTopic.get(response.item_id)
          if (!q?.domain_id || !q.topic_id) continue
          const key = `${q.domain_id}/${q.topic_id}`
          const delta = stamp?.delta ?? eventDelta.get(response.item_id)
          if (delta === undefined) continue
          const current = changes.get(key)
          if (!current) changes.set(key, { domain_id: q.domain_id, topic_id: q.topic_id, name: topicName(q.domain_id, q.topic_id), from_band: stamp?.band_before ?? null, to_band: stamp?.band_after ?? null, from_score: stamp?.before ?? null, to_score: stamp?.after ?? null, delta })
          else { current.delta += delta; current.to_band = stamp?.band_after ?? current.to_band; current.to_score = stamp?.after ?? current.to_score }
        }
      }
      const completedAt = status === 'completed' ? (own[own.length - 1]?.created_at ?? row.updated_at) : null
      sessions.push({
        session_id: row.id, mode: row.mode, selection, topics, title: sessionTitle(row.mode, selection, topics), status,
        started_at: new Date(row.created_at).toISOString(), completed_at: completedAt ? new Date(completedAt).toISOString() : null,
        question_count: plan || answered, answered_count: answered, correct_count: own.filter((response) => Number(response.partial_credit) >= 1).length,
        score_pct: answered > 0 ? Math.round((credit / answered) * 100) : null, mastery_changes: [...changes.values()],
        retake_of: typeof (row.timing_policy as { retake_of?: unknown })?.retake_of === 'string' ? (row.timing_policy as { retake_of: string }).retake_of : null,
      })
    }
    const consumed = lastRow ? rows.indexOf(lastRow) + 1 : 0
    const hasMore = consumed < rows.length || rows.length > limit * 3
    const next_cursor = hasMore && lastRow ? new Date(lastRow.created_at).toISOString() : null
    return NextResponse.json({ success: true, data: sessions, next_cursor })
  } catch (error) {
    console.error('[API] GET /api/assessment/history error:', error)
    return NextResponse.json({ success: false, error: 'Unable to load assessment history' }, { status: 500 })
  }
})
