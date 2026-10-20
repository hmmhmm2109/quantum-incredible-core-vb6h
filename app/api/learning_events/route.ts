import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import { learning_events } from '@/lib/db/schema'
import { desc, eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'

export const GET = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    const repo = scopedRepo(learning_events)
    const data = id ? await repo.findOne(eq(learning_events.id, id)) : await repo.findMany({ orderBy: desc(learning_events.created_at) })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load learning events'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const POST = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const [data] = await scopedRepo(learning_events).insert({
      event_type: String(body.event_type ?? 'practice'), domain_id: String(body.domain_id ?? ''), topic_id: String(body.topic_id ?? ''),
      evidence: body.evidence ?? {}, score_delta: String(body.score_delta ?? '0'), confidence_delta: String(body.confidence_delta ?? '0'),
    })
    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create learning event'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const PATCH = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    const { id, ...updates } = body
    const [data] = await scopedRepo(learning_events).update(eq(learning_events.id, id), updates)
    if (!data) return NextResponse.json({ success: false, error: 'Learning event not found' }, { status: 404 })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update learning event'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const DELETE = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    await scopedRepo(learning_events).delete(eq(learning_events.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete learning event'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})
