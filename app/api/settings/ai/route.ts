import { authMiddleware } from 'lyzr-architect-pg'
import { NextRequest, NextResponse } from 'next/server'
import { ClaudeCliError, modelLabel, providerName, runClaudeJson } from '@/lib/ai-cli'
import { claudeModels, copilotModels } from '@/lib/ai-models'
import { getAiSettings, getAvailability, isProvider, isValidModelId, resolveModel, saveAiSettings } from '@/lib/ai-settings'

// AI provider setting (Claude CLI or Copilot CLI) stored in learner_profiles.preferences.
// GET: provider, failover, availability (copilot: auth hint), the stored model per provider, the effective model per provider and the selectable `models` per provider as { options, source, updated_at } (Claude: CLI aliases + ids; Copilot: `copilot help config`).
// PUT: { provider?, failover?, models?: { claude?, copilot? } } or { model } for the active (or given) provider; a model is a free-text id, or null/'' for the default.
// POST: { provider?, model? } runs one tiny real call through that provider and returns latency or the mapped error.
// Secrets (tokens) are never returned, only whether one is present.

const state = async (refresh = false) => {
  const [settings, availability, claudeList, copilotList] = await Promise.all([getAiSettings(), getAvailability(), claudeModels().catch(() => null), copilotModels(refresh).catch(() => null)])
  const effective = (provider: 'claude' | 'copilot') => {
    const { id, source } = resolveModel(provider, settings.models[provider])
    return { id, source, label: modelLabel(provider, settings.models[provider]) }
  }
  // `model` = what the profile stored (null = default); `effective` = what a call would use now.
  return { provider: settings.provider, failover: settings.failover, model: settings.models, effective: { claude: effective('claude'), copilot: effective('copilot') }, availability, models: { claude: claudeList, copilot: copilotList } }
}

const MODEL_ERROR = 'model must be an id of 1-80 letters, digits or . _ : / - (no spaces, not starting with "-"), or null'

export const GET = authMiddleware(async (req: NextRequest) => {
  try {
    // ?refresh=1 re-reads Copilot's live model list instead of using the 10-minute cache.
    return NextResponse.json({ success: true, data: await state(req.nextUrl.searchParams.get('refresh') === '1') })
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
    const models: { claude?: string | null; copilot?: string | null } = {}
    if (body.models !== undefined) {
      if (!body.models || typeof body.models !== 'object' || Array.isArray(body.models)) return NextResponse.json({ success: false, error: 'models must be an object' }, { status: 400 })
      for (const key of Object.keys(body.models)) if (!isProvider(key)) return NextResponse.json({ success: false, error: `unknown provider "${key.slice(0, 20)}" in models` }, { status: 400 })
      for (const provider of ['claude', 'copilot'] as const) {
        const value = body.models[provider]
        if (value === undefined) continue
        if (value !== null && !isValidModelId(value)) return NextResponse.json({ success: false, error: MODEL_ERROR }, { status: 400 })
        models[provider] = value
      }
    }
    if (body.model !== undefined) {
      const value = body.model === '' ? null : body.model
      if (value !== null && !isValidModelId(value)) return NextResponse.json({ success: false, error: MODEL_ERROR }, { status: 400 })
      models[body.provider ?? (await getAiSettings()).provider] = value
    }
    if (body.provider === undefined && body.failover === undefined && Object.keys(models).length === 0) return NextResponse.json({ success: false, error: 'provider, failover, model or models is required' }, { status: 400 })
    await saveAiSettings({ provider: body.provider, failover: body.failover, models })
    return NextResponse.json({ success: true, data: await state() })
  } catch (error) {
    console.error('[API] PUT /api/settings/ai:', error)
    return NextResponse.json({ success: false, error: 'Unable to save AI settings' }, { status: 400 })
  }
})

export const POST = authMiddleware(async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  if (body.provider !== undefined && !isProvider(body.provider)) return NextResponse.json({ success: false, error: "provider must be 'claude' or 'copilot'" }, { status: 400 })
  if (body.model !== undefined && !isValidModelId(body.model)) return NextResponse.json({ success: false, error: MODEL_ERROR }, { status: 400 })
  const settings = await getAiSettings()
  const provider = body.provider ?? settings.provider
  const model = resolveModel(provider, body.model ?? settings.models[provider]).id
  const startedAt = Date.now()
  try {
    const result = await runClaudeJson({
      systemPrompt: 'You are a connectivity probe. Answer with the JSON object only.',
      message: 'Reply with {"ok":true}',
      jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      timeoutMs: 60_000,
      purpose: 'settings/test',
      provider,
      ...(body.model !== undefined ? { model: body.model } : {}),
    }) as { ok?: boolean }
    return NextResponse.json({ success: true, data: { provider, label: providerName(provider), model: model ?? 'auto', ok: result?.ok === true, latency_ms: Date.now() - startedAt } })
  } catch (error) {
    if (error instanceof ClaudeCliError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[API] POST /api/settings/ai:', error)
    return NextResponse.json({ success: false, error: 'Connection test failed' }, { status: 500 })
  }
})
