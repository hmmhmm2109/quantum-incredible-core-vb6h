import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import { learner_profiles } from '@/lib/db/schema'
import { desc, eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'

export const GET = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    const repo = scopedRepo(learner_profiles)
    const data = id ? await repo.findOne(eq(learner_profiles.id, id)) : await repo.findMany({ orderBy: desc(learner_profiles.created_at) })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load learner profiles'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const POST = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    const [data] = await scopedRepo(learner_profiles).insert({
      display_name: String(body.display_name ?? 'Learner'), preferences: body.preferences ?? {}, onboarding_state: body.onboarding_state ?? {},
    })
    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create learner profile'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const PATCH = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    const { id, ...updates } = body
    const [data] = await scopedRepo(learner_profiles).update(eq(learner_profiles.id, id), updates)
    if (!data) return NextResponse.json({ success: false, error: 'Learner profile not found' }, { status: 404 })
    return NextResponse.json({ success: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update learner profile'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})

export const DELETE = authMiddleware(async (req: NextRequest) => {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })
    await scopedRepo(learner_profiles).delete(eq(learner_profiles.id, id))
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to delete learner profile'
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
})
