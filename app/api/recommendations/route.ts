import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import { recommendations } from '@/lib/db/schema'
import { desc, eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'

export const GET = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    const repo = scopedRepo(recommendations)
    const data = id ? await repo.findOne(eq(recommendations.id, id)) : await repo.findMany({ orderBy: desc(recommendations.created_at) })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[API] /api/recommendations:', error)
    const message = 'Unable to load recommendations'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const POST = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const [data] = await scopedRepo(recommendations).insert({
      activity_id: String(body.activity_id ?? ''), activity_metadata: body.activity_metadata ?? {}, rationale: String(body.rationale ?? ''), status: String(body.status ?? 'queued'),
    })
    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (error) {
    console.error('[API] /api/recommendations:', error)
    const message = 'Unable to create recommendation'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const PATCH = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    const { id, ...updates } = body
    const [data] = await scopedRepo(recommendations).update(eq(recommendations.id, id), updates)
    if (!data) return NextResponse.json({ success: false, error: 'Recommendation not found' }, { status: 404 })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[API] /api/recommendations:', error)
    const message = 'Unable to update recommendation'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const DELETE = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    await scopedRepo(recommendations).delete(eq(recommendations.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API] /api/recommendations:', error)
    const message = 'Unable to delete recommendation'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})
