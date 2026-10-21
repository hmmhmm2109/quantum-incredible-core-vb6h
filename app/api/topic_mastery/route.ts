import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import { topic_mastery } from '@/lib/db/schema'
import { desc, eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'

export const GET = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    const repo = scopedRepo(topic_mastery)
    const data = id ? await repo.findOne(eq(topic_mastery.id, id)) : await repo.findMany({ orderBy: desc(topic_mastery.created_at) })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[API] /api/topic_mastery:', error)
    const message = 'Unable to load topic mastery'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const POST = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const [data] = await scopedRepo(topic_mastery).insert({
      domain_id: String(body.domain_id ?? ''), topic_id: String(body.topic_id ?? ''), pack_version: String(body.pack_version ?? 'v1'),
      score: String(body.score ?? '0'), level_band: String(body.level_band ?? 'Basic'), confidence: String(body.confidence ?? '0'), evidence_summary: body.evidence_summary ?? {},
    })
    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (error) {
    console.error('[API] /api/topic_mastery:', error)
    const message = 'Unable to create topic mastery'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const PATCH = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    const { id, ...updates } = body
    const [data] = await scopedRepo(topic_mastery).update(eq(topic_mastery.id, id), updates)
    if (!data) return NextResponse.json({ success: false, error: 'Topic mastery not found' }, { status: 404 })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    console.error('[API] /api/topic_mastery:', error)
    const message = 'Unable to update topic mastery'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const DELETE = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    await scopedRepo(topic_mastery).delete(eq(topic_mastery.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API] /api/topic_mastery:', error)
    const message = 'Unable to delete topic mastery'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})
