import { authMiddleware, getCurrentUserId, getDb } from 'lyzr-architect-pg'
import { and, eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'
import { attempts, topic_lessons } from '@/lib/db/schema'
import { multiKind } from '@/lib/practice-multi'
import { DOMAINS } from '@/lib/taxonomy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/lesson/solution { activity_id }: the reference solution of a practice exercise, only once the learner has an attempt on it.
// 0 Claude calls: the solution is written with the exercise and stays in topic_lessons (/api/lesson never sends it).
// { success: true, data: { available: false } } when there is no attempt yet or the exercise predates the feature.

// lesson-<domain>-<topic>[-pN] -> the cache row of that single-topic exercise.
function singleLocator(activityId: string) {
  for (const domain of DOMAINS) {
    for (const topic of domain.topics) {
      const base = `lesson-${domain.id}-${topic.id}`
      if (activityId === base) return { domain_id: domain.id, topic_id: topic.id, kind: 'practice' }
      const match = activityId.startsWith(`${base}-p`) ? /^(\d+)$/.exec(activityId.slice(base.length + 2)) : null
      if (match && Number(match[1]) >= 2) return { domain_id: domain.id, topic_id: topic.id, kind: `practice:${match[1]}` }
    }
  }
  return null
}

export const POST = authMiddleware(async (req: NextRequest) => {
  try {
    const ownerId = getCurrentUserId()
    if (!ownerId) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const activityId = typeof body.activity_id === 'string' ? body.activity_id : ''
    if (!activityId) return NextResponse.json({ success: false, error: 'activity_id is required' }, { status: 400 })
    const db = getDb()
    const [attempt] = await db.select({ id: attempts.id }).from(attempts).where(and(eq(attempts.owner_user_id, ownerId), eq(attempts.activity_id, activityId))).limit(1)
    if (!attempt) return NextResponse.json({ success: true, data: { available: false } })

    const multi = /^lesson-multi-([0-9a-f]{14})(?:-p(\d+))?$/.exec(activityId)
    const where = multi
      ? eq(topic_lessons.kind, multiKind(multi[1], multi[2] ? Number(multi[2]) : 1))
      : (() => { const at = singleLocator(activityId); return at ? and(eq(topic_lessons.domain_id, at.domain_id), eq(topic_lessons.topic_id, at.topic_id), eq(topic_lessons.kind, at.kind)) : undefined })()
    if (!where) return NextResponse.json({ success: true, data: { available: false } })
    const [row] = await db.select({ content: topic_lessons.content }).from(topic_lessons).where(where).limit(1)
    const solution = (row?.content as { reference_solution?: { files?: unknown; explanation?: unknown } } | undefined)?.reference_solution
    if (!solution || !Array.isArray(solution.files)) return NextResponse.json({ success: true, data: { available: false } })
    const files = solution.files.flatMap((file) => {
      const entry = file as { path?: unknown; content?: unknown }
      return typeof entry?.path === 'string' && typeof entry.content === 'string' ? [{ path: entry.path, content: entry.content }] : []
    })
    return NextResponse.json({ success: true, data: { available: files.length > 0, files, explanation: typeof solution.explanation === 'string' ? solution.explanation : '' } })
  } catch (error) {
    console.error('[API] POST /api/lesson/solution:', error)
    return NextResponse.json({ success: false, error: 'Unable to load the reference solution' }, { status: 500 })
  }
})
