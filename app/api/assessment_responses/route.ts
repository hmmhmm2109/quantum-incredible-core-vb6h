import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import { assessment_responses } from '@/lib/db/schema'
import { desc, eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'

export const GET = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    const repo = scopedRepo(assessment_responses)
    const data = id ? await repo.findOne(eq(assessment_responses.id, id)) : await repo.findMany({ orderBy: desc(assessment_responses.created_at) })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load assessment responses'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const POST = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const [data] = await scopedRepo(assessment_responses).insert({
      item_id: String(body.item_id ?? ''), session_id: String(body.session_id ?? ''), selected_answers: body.selected_answers ?? [],
      justification: String(body.justification ?? ''), response_time_ms: Number(body.response_time_ms ?? 0), partial_credit: String(body.partial_credit ?? '0'),
      feedback: body.feedback ?? {}, challenge_state: String(body.challenge_state ?? 'in_progress'), mastery_evidence: body.mastery_evidence ?? {},
    })
    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create assessment response'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const PATCH = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    const { id, ...updates } = body
    const [data] = await scopedRepo(assessment_responses).update(eq(assessment_responses.id, id), updates)
    if (!data) return NextResponse.json({ success: false, error: 'Assessment response not found' }, { status: 404 })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update assessment response'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const DELETE = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    await scopedRepo(assessment_responses).delete(eq(assessment_responses.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete assessment response'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})
