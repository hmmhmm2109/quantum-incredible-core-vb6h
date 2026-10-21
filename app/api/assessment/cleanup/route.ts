import { authMiddleware, getCurrentUserId, getDb, scopedRepo } from 'lyzr-architect-pg'
import { and, eq, lt, notInArray } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'
import { assessment_responses, assessment_sessions } from '@/lib/db/schema'

// An in_progress session older than this with no graded response is treated as abandoned (tab closed before answering).
// Nothing is deleted. A stale session that already has a response keeps its data and status: it is not abandoned.
const STALE_SESSION_MS = 24 * 60 * 60 * 1000

export const POST = authMiddleware(async (_req: NextRequest) => {
  try {
    const cutoff = new Date(Date.now() - STALE_SESSION_MS)
    const ownerId = getCurrentUserId()
    if (!ownerId) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    const answered = (await getDb().selectDistinct({ id: assessment_responses.session_id }).from(assessment_responses).where(eq(assessment_responses.owner_user_id, ownerId))).map((row) => row.id)
    const stale = await scopedRepo(assessment_sessions).update(
      and(eq(assessment_sessions.status, 'in_progress'), lt(assessment_sessions.created_at, cutoff), ...(answered.length ? [notInArray(assessment_sessions.id, answered)] : [])),
      { status: 'abandoned' },
    )
    return NextResponse.json({ success: true, data: { abandoned: stale.length } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to clean up assessment sessions'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})
