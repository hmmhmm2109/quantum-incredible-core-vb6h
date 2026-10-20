// Uses the Web-standard Request/Response rather than next/server. Next
// supports both, and staying standard keeps this route unit-testable under
// plain `node --test`, which cannot resolve `next/server`.

// Host only — the deployed value carries no /v1 suffix, so it is appended here.
// Appending unconditionally would double it if someone sets the full path.
const RAW_BASE = process.env.LYZR_VOICE_BASE_URL || 'https://voice-livekit.studio.lyzr.ai'
const VOICE_BASE = RAW_BASE.replace(/\/+$/, '').endsWith('/v1')
  ? RAW_BASE.replace(/\/+$/, '')
  : `${RAW_BASE.replace(/\/+$/, '')}/v1`

const LYZR_API_KEY = process.env.LYZR_API_KEY || ''
const DEFAULT_AGENT_ID = process.env.LYZR_VOICE_AGENT_ID || process.env.VOICE_AGENT_ID || ''

type Mode = 'start' | 'end' | 'transcript' | 'history'

export interface VoiceSession {
  userToken: string
  roomName: string
  sessionId: string
  livekitUrl: string
  agentDispatched: boolean
  agentConfig?: { engine?: Record<string, any>; tools?: string[] }
}

function upstream(path: string, init?: RequestInit) {
  return fetch(`${VOICE_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
      'x-api-key': LYZR_API_KEY,
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  })
}

function fail(message: string, status: number, extra?: Record<string, any>) {
  return Response.json({ success: false, error: message, ...extra }, { status })
}

/**
 * `conversation_start.greeting` reaches the realtime model as an INSTRUCTION,
 * not as literal speech.
 *
 * Bare text reads as context, so the model improvises its own opening — and
 * because the surrounding prompt describes a job, it tends to start performing
 * that job from imagination rather than calling its tools. Wrapping it as
 * `Say, "..."` is the convention the voice service expects.
 */
const ALREADY_SPEAKABLE = /^[Ss]ay,?\s+["'][\s\S]*["']\s*$/

function speakableGreeting(greeting: string): string {
  const text = greeting.trim()
  if (!text || ALREADY_SPEAKABLE.test(text)) return text
  // Inner double quotes would close the wrapper early.
  return `Say, "${text.replace(/"/g, "'")}"`
}

/**
 * Read the saved agent so a session can be started with its full config.
 *
 * The session API does merge a partial `agentConfig` over the stored one, but
 * the greeting has to be transformed before dispatch, so the config is fetched,
 * adjusted, and sent whole. That also keeps this request identical in shape to
 * the one the Lyzr voice console sends, which is the reference for debugging.
 */
async function fetchAgentConfig(agentId: string): Promise<Record<string, any>> {
  const res = await upstream(`/agents/${encodeURIComponent(agentId)}`)
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(
      data?.error || data?.message || `Could not load voice agent ${agentId} (HTTP ${res.status})`
    )
  }

  const config = data?.agent?.config
  if (!config || typeof config !== 'object') {
    throw new Error(`Voice agent ${agentId} returned no config`)
  }
  return config as Record<string, any>
}

/**
 * POST /api/voice/session
 *
 * Four modes on one route, dispatched on `mode` — the same shape as the
 * two-mode POST in /api/agent.
 *
 *   { mode: 'start',      agentId?, userIdentity?, dynamicVariables? }
 *   { mode: 'end',        roomName }
 *   { mode: 'transcript', sessionId }
 *   { mode: 'history',    agentId?, limit?, offset? }
 *
 * LYZR_API_KEY stays here. The browser receives only the LiveKit userToken,
 * which is scoped to a single room.
 *
 * Status-code contract matches /api/agent: fetchWrapper escalates 5xx to the
 * parent preview as a child-app error, so 5xx is reserved for genuine server
 * failures. A transcript that is not written yet is an expected in-band
 * outcome and returns 200 + { status: 'pending' }.
 */
export async function POST(request: Request) {
  if (!LYZR_API_KEY) {
    return fail('LYZR_API_KEY not configured on server', 500)
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return fail('Invalid JSON in request body', 400)
  }

  const mode: Mode = body?.mode
  try {
    switch (mode) {
      case 'start':
        return await startSession(body)
      case 'end':
        return await endSession(body)
      case 'transcript':
        return await getTranscript(body)
      case 'history':
        return await getHistory(body)
      default:
        return fail(`Unknown mode "${mode}". Expected start | end | transcript | history.`, 400)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Voice service unreachable'
    return fail(message, 502)
  }
}

async function startSession(body: any) {
  const agentId = body.agentId || DEFAULT_AGENT_ID

  // Upstream treats a missing agentId as "use the default pipeline agent" and
  // returns 200. That is a silently wrong agent, so refuse it here instead.
  if (!agentId) {
    return fail(
      'agentId is required. Pass it from the client or set LYZR_VOICE_AGENT_ID.',
      400
    )
  }

  const userIdentity: string = body.userIdentity || `user-${crypto.randomUUID()}`

  let stored: Record<string, any>
  try {
    stored = await fetchAgentConfig(agentId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load the voice agent'
    return fail(message, 502)
  }

  // This template renders no avatar, so the avatar block is dropped rather
  // than dispatching an avatar worker nobody displays.
  const { avatar: _avatar, ...rest } = stored

  // The stored config never carries a raw api_key — credentials are not
  // persisted on the agent doc — so it is supplied here, server-side only.
  // Without it every Lyzr-proxied call the worker makes (realtime LLM/TTS,
  // tool execution, RAG retrieval) fails.
  const agentConfig: Record<string, any> = { ...rest, api_key: LYZR_API_KEY }

  const start = agentConfig.conversation_start
  if (start?.who === 'ai' && typeof start.greeting === 'string') {
    agentConfig.conversation_start = { ...start, greeting: speakableGreeting(start.greeting) }
  }

  // dynamic_variables are only accepted nested inside agentConfig.
  if (body.dynamicVariables && Object.keys(body.dynamicVariables).length > 0) {
    agentConfig.dynamic_variables = body.dynamicVariables
  }

  const payload: Record<string, unknown> = { agentId, userIdentity, agentConfig }

  const res = await upstream('/sessions/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return fail(data?.error || data?.message || 'Failed to start voice session', res.status, {
      details: data,
    })
  }

  return Response.json({ success: true, session: data as VoiceSession })
}

async function endSession(body: any) {
  const roomName: string = body.roomName
  if (!roomName) {
    return fail('roomName is required to end a session', 400)
  }

  const res = await upstream('/sessions/end', {
    method: 'POST',
    body: JSON.stringify({ roomName }),
  })

  // Upstream answers 204 with a genuinely empty body — res.json() throws here.
  // Read as text and treat empty-but-ok as success.
  const text = await res.text()
  let data: any = {}
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = {}
    }
  }

  if (!res.ok) {
    return fail(data?.error || data?.message || 'Failed to end voice session', res.status)
  }

  return Response.json({ success: true, ...data })
}

async function getTranscript(body: any) {
  const sessionId: string = body.sessionId
  if (!sessionId) {
    return fail('sessionId is required', 400)
  }

  const res = await upstream(`/transcripts/${encodeURIComponent(sessionId)}`)

  // Transcripts are written asynchronously after the call ends, so a 404 here
  // means "not ready yet", not "failed". Reporting it as an error would make
  // every healthy call look broken for the first few seconds.
  if (res.status === 404) {
    return Response.json({ success: true, status: 'pending', transcript: null })
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return fail(data?.error || 'Failed to fetch transcript', res.status)
  }

  return Response.json({ success: true, status: 'ready', transcript: data })
}

async function getHistory(body: any) {
  const agentId = body.agentId || DEFAULT_AGENT_ID
  if (!agentId) {
    return fail('agentId is required for history', 400)
  }

  const params = new URLSearchParams()
  if (body.limit) params.set('limit', String(body.limit))
  if (body.offset) params.set('offset', String(body.offset))
  const qs = params.toString() ? `?${params.toString()}` : ''

  const [listRes, statsRes] = await Promise.all([
    upstream(`/transcripts/agent/${encodeURIComponent(agentId)}${qs}`),
    upstream(`/transcripts/agent/${encodeURIComponent(agentId)}/stats`),
  ])

  const list = await listRes.json().catch(() => ({}))
  if (!listRes.ok) {
    return fail(list?.error || 'Failed to fetch call history', listRes.status)
  }

  // Stats are supplementary — a failure there must not sink the list.
  const stats = statsRes.ok ? await statsRes.json().catch(() => null) : null

  return Response.json({ success: true, ...list, stats })
}
