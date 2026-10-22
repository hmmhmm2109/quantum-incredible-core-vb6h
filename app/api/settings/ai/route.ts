import { authMiddleware } from 'lyzr-architect-pg'
import { NextRequest, NextResponse } from 'next/server'
import { ClaudeCliError, modelLabel, providerName, runClaudeJson } from '@/lib/ai-cli'
import { getAiSettings, getAvailability, isProvider, saveAiSettings } from '@/lib/ai-settings'

// AI provider setting (Claude CLI or Copilot CLI) stored in learner_profiles.preferences.
// GET: current setting + whether each CLI is installed (copilot: auth hint). PUT: { provider?, failover? }.
// POST: { provider? } runs one tiny real call through that provider and returns latency or the mapped error.
// Secrets (tokens) are never returned, only whether one is present.

const state = async () => {
  const [settings, availability] = await Promise.all([getAiSettings(), getAvailability()])
  return { ...settings, models: { claude: modelLabel('claude'), copilot: modelLabel('copilot') }, availability }
}

export const GET = authMiddleware(async (_req: NextRequest) => {
  try {
    return NextResponse.json({ success: true, data: await state() })
  } catch (error) {
    console.error('[API] GET /api/settings/ai:', error)
    return NextResponse.json({ success: false, error: 'Unable to load AI settings' }, { status: 400 })
  }
})

export const PUT = authMiddleware(async (req: NextRequest) => {
  try {
    const body = await req.json().catch(() => ({}))
    if (body.provider !== undefined && !isProvider(body.provider)) return NextResponse.json({ success: false, error: "provider must be 'claude' or 'copilot'" }, { status: 400 })
    if (body.failover !== undefined && typeof body.failover !== 'boolean') return NextResponse.json({ success: false, error: 'failover must be a boolean' }, { status: 400 })
    if (body.provider === undefined && body.failover === undefined) return NextResponse.json({ success: false, error: 'provider or failover is required' }, { status: 400 })
    await saveAiSettings({ provider: body.provider, failover: body.failover })
    return NextResponse.json({ success: true, data: await state() })
  } catch (error) {
    console.error('[API] PUT /api/settings/ai:', error)
    return NextResponse.json({ success: false, error: 'Unable to save AI settings' }, { status: 400 })
  }
})

export const POST = authMiddleware(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  if (body.provider !== undefined && !isProvider(body.provider)) return NextResponse.json({ success: false, error: "provider must be 'claude' or 'copilot'" }, { status: 400 })
  const provider = body.provider ?? (await getAiSettings()).provider
  const startedAt = Date.now()
  try {
    const result = await runClaudeJson({
      systemPrompt: 'You are a connectivity probe. Answer with the JSON object only.',
      message: 'Reply with {"ok":true}',
      jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      timeoutMs: 60_000,
      purpose: 'settings/test',
      provider,
    }) as { ok?: boolean }
    return NextResponse.json({ success: true, data: { provider, label: providerName(provider), ok: result?.ok === true, latency_ms: Date.now() - startedAt } })
  } catch (error) {
    if (error instanceof ClaudeCliError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[API] POST /api/settings/ai:', error)
    return NextResponse.json({ success: false, error: 'Connection test failed' }, { status: 500 })
  }
})
