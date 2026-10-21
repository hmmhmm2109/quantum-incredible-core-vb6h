import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import { activities } from '@/lib/db/schema'
import { desc, eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'

export const GET = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    const repo = scopedRepo(activities)
    const data = id ? await repo.findOne(eq(activities.id, id)) : await repo.findMany({ orderBy: desc(activities.created_at) })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[API] /api/activities:', error)
    const message = 'Unable to load activities'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const POST = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const [data] = await scopedRepo(activities).insert({
      domain_id: String(body.domain_id ?? ''), topic_id: String(body.topic_id ?? ''), pack_version: String(body.pack_version ?? 'v1'),
      level: String(body.level ?? 'Basic'), format: String(body.format ?? 'concept_explanation'), prompt: String(body.prompt ?? ''),
      starter_assets: body.starter_assets ?? [], rubric: body.rubric ?? [], status: String(body.status ?? 'active'),
    })
    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (error) {
    console.error('[API] /api/activities:', error)
    const message = 'Unable to create activity'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const PATCH = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    const { id, ...updates } = body
    const [data] = await scopedRepo(activities).update(eq(activities.id, id), updates)
    if (!data) return NextResponse.json({ success: false, error: 'Activity not found' }, { status: 404 })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[API] /api/activities:', error)
    const message = 'Unable to update activity'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const DELETE = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    await scopedRepo(activities).delete(eq(activities.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API] /api/activities:', error)
    const message = 'Unable to delete activity'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})
