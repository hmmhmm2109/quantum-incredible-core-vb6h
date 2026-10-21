import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import { and, eq, lt } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'
import { assessment_sessions } from '@/lib/db/schema'

// An in_progress session older than this is treated as abandoned (tab closed mid-assessment). Nothing is deleted:
// the session, its items and any graded responses stay, and graded responses keep counting toward mastery.
const STALE_SESSION_MS = 24 * 60 * 60 * 1000

export const POST = authMiddleware(async (_req: NextRequest) => {
  try {
    const cutoff = new Date(Date.now() - STALE_SESSION_MS)
    const stale = await scopedRepo(assessment_sessions).update(
      and(eq(assessment_sessions.status, 'in_progress'), lt(assessment_sessions.created_at, cutoff)),
      { status: 'abandoned' },
    )
    return NextResponse.json({ success: true, data: { abandoned: stale.length } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to clean up assessment sessions'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})
