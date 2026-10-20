'use client'

/**
 * Voice Agent Client Utility
 *
 * Client-side wrapper for the /api/voice/session route. The Lyzr API key stays
 * on the server; the browser only ever receives a LiveKit token scoped to one
 * room.
 *
 * Most UI should use the hooks (`useVoiceSession`, `useTranscript`) rather than
 * these functions directly — the hooks own the room lifecycle.
 *
 * MUST be used from 'use client' components only.
 */

const ENDPOINT = '/api/voice/session'

// =============================================================================
// Types
// =============================================================================

export interface VoiceSession {
  userToken: string
  roomName: string
  sessionId: string
  livekitUrl: string
  agentDispatched: boolean
  agentConfig?: { engine?: Record<string, any>; tools?: string[] }
}

/** One line of dialogue, from the live room or from a persisted transcript. */
export interface TranscriptItem {
  id: string
  role: 'user' | 'agent'
  text: string
  /** False while the speaker is still mid-utterance (live only). */
  final: boolean
  timestamp: number
}

export interface PersistedTranscript {
  id: string
  sessionId: string
  roomName: string
  callType: 'web' | 'phone_inbound' | 'phone_outbound'
  agentId: string | null
  chatHistory?: Array<Record<string, any>>
  sessionReport?: Record<string, any>
  closeReason?: string | null
  durationMs?: number | null
  messageCount: number
  sentiment?: Record<string, any> | null
}

export interface AgentTranscriptStats {
  totalCalls: number
  browserCalls: number
  phoneCalls: number
  avgMessages: number
}

export interface CallHistory {
  items: PersistedTranscript[]
  stats: AgentTranscriptStats | null
}

export class VoiceError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'VoiceError'
    this.status = status
  }
}

// =============================================================================
// Internals
// =============================================================================

async function post<T>(body: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new VoiceError('Could not reach the voice service.')
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.success === false) {
    throw new VoiceError(data?.error || `Voice request failed (${res.status})`, res.status)
  }
  return data as T
}

// =============================================================================
// API
// =============================================================================

/**
 * Start a voice session and get the LiveKit credentials for joining the room.
 *
 * `dynamicVariables` fill `{{placeholders}}` in the agent's prompt for this
 * call only.
 */
export async function startVoiceSession(opts: {
  agentId?: string
  userIdentity?: string
  dynamicVariables?: Record<string, string>
}): Promise<VoiceSession> {
  const data = await post<{ session: VoiceSession }>({ mode: 'start', ...opts })
  return data.session
}

/**
 * End a voice session server-side.
 *
 * Disconnecting the browser alone leaves the agent running and billing, so this
 * must be called on every hangup. `useVoiceSession` does it for you.
 */
export async function endVoiceSession(roomName: string): Promise<void> {
  await post({ mode: 'end', roomName })
}

/**
 * Fetch the persisted transcript for a finished call.
 *
 * Returns `null` when the transcript exists but is not written yet — this is
 * normal for the first few seconds after a call and is not an error. Prefer
 * `useTranscript`, which handles the polling.
 */
export async function fetchTranscript(sessionId: string): Promise<PersistedTranscript | null> {
  const data = await post<{ status: 'pending' | 'ready'; transcript: PersistedTranscript | null }>({
    mode: 'transcript',
    sessionId,
  })
  return data.status === 'ready' ? data.transcript : null
}

/** List past calls for an agent, newest first, with aggregate stats. */
export async function fetchCallHistory(opts: {
  agentId?: string
  limit?: number
  offset?: number
} = {}): Promise<CallHistory> {
  const data = await post<{ items?: PersistedTranscript[]; stats: AgentTranscriptStats | null }>({
    mode: 'history',
    ...opts,
  })
  return { items: data.items ?? [], stats: data.stats ?? null }
}
