import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import { assessment_items } from '@/lib/db/schema'
import { desc, eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'
import { stripAnswerKey } from '@/lib/assessment-redact'

export const GET = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    const repo = scopedRepo(assessment_items)
    const data = id ? await repo.findOne(eq(assessment_items.id, id)) : await repo.findMany({ orderBy: desc(assessment_items.created_at) })
    return NextResponse.json({ success: true, data: Array.isArray(data) ? data.map(stripAnswerKey) : stripAnswerKey(data) })
  } catch (error) {
    console.error('[API] /api/assessment_items:', error)
    const message = 'Unable to load assessment items'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const POST = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const [data] = await scopedRepo(assessment_items).insert({
      session_id: String(body.session_id ?? ''), blueprint_id: String(body.blueprint_id ?? ''), blueprint_version: String(body.blueprint_version ?? 'v1'),
      generated_question: body.generated_question ?? {}, difficulty_factors: body.difficulty_factors ?? [], validation_evidence: body.validation_evidence ?? {},
      answer_rules: body.answer_rules ?? {}, review_snapshot: body.review_snapshot ?? {},
    })
    return NextResponse.json({ success: true, data: stripAnswerKey(data) }, { status: 201 })
  } catch (error) {
    console.error('[API] /api/assessment_items:', error)
    const message = 'Unable to create assessment item'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const PATCH = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    // review_snapshot holds the server-side answer key and difficulty_factors the rationale shown after grading, so clients may not rewrite them.
    const { id, review_snapshot: _ignored, difficulty_factors: _rationale, ...updates } = body
    const [data] = await scopedRepo(assessment_items).update(eq(assessment_items.id, id), updates)
    if (!data) return NextResponse.json({ success: false, error: 'Assessment item not found' }, { status: 404 })
    return NextResponse.json({ success: true, data: stripAnswerKey(data) })
  } catch (error) {
    console.error('[API] /api/assessment_items:', error)
    const message = 'Unable to update assessment item'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const DELETE = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    await scopedRepo(assessment_items).delete(eq(assessment_items.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[API] /api/assessment_items:', error)
    const message = 'Unable to delete assessment item'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})
