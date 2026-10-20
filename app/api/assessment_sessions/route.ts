import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import { assessment_sessions } from '@/lib/db/schema'
import { desc, eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'

export const GET = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    const repo = scopedRepo(assessment_sessions)
    const data = id ? await repo.findOne(eq(assessment_sessions.id, id)) : await repo.findMany({ orderBy: desc(assessment_sessions.created_at) })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load assessment sessions'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const POST = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const [data] = await scopedRepo(assessment_sessions).insert({
      mode: String(body.mode ?? 'knowledge_check'), topic_coverage: body.topic_coverage ?? [], timing_policy: body.timing_policy ?? {},
      score: String(body.score ?? '0'), confidence: String(body.confidence ?? '0'), mastery_impact: body.mastery_impact ?? {}, status: String(body.status ?? 'active'),
    })
    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create assessment session'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const PATCH = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    const { id, ...updates } = body
    const [data] = await scopedRepo(assessment_sessions).update(eq(assessment_sessions.id, id), updates)
    if (!data) return NextResponse.json({ success: false, error: 'Assessment session not found' }, { status: 404 })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update assessment session'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const DELETE = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    await scopedRepo(assessment_sessions).delete(eq(assessment_sessions.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete assessment session'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})
