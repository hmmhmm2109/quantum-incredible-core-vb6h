import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import { attempts } from '@/lib/db/schema'
import { desc, eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'

export const GET = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    const repo = scopedRepo(attempts)
    const data = id ? await repo.findOne(eq(attempts.id, id)) : await repo.findMany({ orderBy: desc(attempts.created_at) })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load attempts'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const POST = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const [data] = await scopedRepo(attempts).insert({
      activity_id: String(body.activity_id ?? ''), response: body.response ?? {}, execution_result: body.execution_result ?? {},
      score: String(body.score ?? '0'), hint_count: Number(body.hint_count ?? 0), feedback: body.feedback ?? {}, completion_state: String(body.completion_state ?? 'draft'),
    })
    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create attempt'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const PATCH = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    const { id, ...updates } = body
    const [data] = await scopedRepo(attempts).update(eq(attempts.id, id), updates)
    if (!data) return NextResponse.json({ success: false, error: 'Attempt not found' }, { status: 404 })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update attempt'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const DELETE = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    await scopedRepo(attempts).delete(eq(attempts.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete attempt'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})
