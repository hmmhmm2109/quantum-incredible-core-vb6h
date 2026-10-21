import { authMiddleware, getCurrentUserId, getDb } from 'lyzr-architect-pg'
import { and, eq, gte, sql } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'
import { learning_events, topic_mastery } from '@/lib/db/schema'
import { isValidTopicId, findDomain } from '@/lib/taxonomy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/lesson/complete { domain_id, topic_id }: the learner marked a lesson as learned.
// In one transaction it appends a 'lesson' learning event (at most one per owner/topic/day, so repeat clicks are no-ops)
// and makes sure a topic_mastery row exists. A new row has score 0 and level 'Not started' with evidence_summary.state 'learned';
// an existing row (learned or assessed) is never touched, so marking a lesson can not move a rating. The first assessment grade overwrites the state.

export const POST = authMiddleware(async (request: NextRequest) => {
  try {
    const body = await request.json().catch(() => ({}))
    const domainId = String(body.domain_id ?? '')
    const topicId = String(body.topic_id ?? '')
    if (!findDomain(domainId) || !isValidTopicId(domainId, topicId)) return NextResponse.json({ success: false, error: 'domain_id and topic_id must be a taxonomy topic' }, { status: 400 })
    const ownerId = getCurrentUserId()
    if (!ownerId) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const data = await getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lesson:${ownerId}:${domainId}:${topicId}`}))`)
      const [mastery] = await tx.select({ id: topic_mastery.id }).from(topic_mastery).where(and(eq(topic_mastery.owner_user_id, ownerId), eq(topic_mastery.domain_id, domainId), eq(topic_mastery.topic_id, topicId))).limit(1)
      if (!mastery) await tx.insert(topic_mastery).values({ domain_id: domainId, topic_id: topicId, pack_version: 'v1', score: '0', level_band: 'Not started', confidence: '0', evidence_summary: { state: 'learned', evidence: [], recommended_focus: 'Learned, not assessed yet. Take the topic assessment to get a rating.' }, owner_user_id: ownerId })
      const [today] = await tx.select({ id: learning_events.id }).from(learning_events).where(and(eq(learning_events.owner_user_id, ownerId), eq(learning_events.event_type, 'lesson'), eq(learning_events.domain_id, domainId), eq(learning_events.topic_id, topicId), gte(learning_events.created_at, sql`date_trunc('day', now())`))).limit(1)
      if (!today) await tx.insert(learning_events).values({ event_type: 'lesson', domain_id: domainId, topic_id: topicId, evidence: { kind: 'lesson_completed' }, score_delta: '0', confidence_delta: '0', owner_user_id: ownerId })
      return { domain_id: domainId, topic_id: topicId, mastery_created: !mastery, event_created: !today }
    })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[API] POST /api/lesson/complete error:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to mark this lesson as learned' }, { status: 500 })
  }
})
