'use client'

/**
 * useTranscript Hook
 *
 * Fetches the persisted transcript for a finished call.
 *
 * Transcripts are written asynchronously, so the service returns 404 for the
 * first few seconds after a call ends. That is `pending`, not an error — this
 * hook polls with backoff until the transcript appears.
 *
 * @example
 * ```tsx
 * const call = useVoiceSession({ agentId: AGENT_ID })
 * const t = useTranscript(call.state === 'ended' ? call.sessionId : null)
 *
 * {t.status === 'pending' && <p>Preparing your transcript…</p>}
 * {t.status === 'ready' && <TranscriptView items={t.items} />}
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchTranscript, PersistedTranscript, TranscriptItem } from '@/lib/voiceAgent'

export type TranscriptStatus = 'idle' | 'pending' | 'ready' | 'timeout' | 'error'

export interface UseTranscriptResult {
  status: TranscriptStatus
  /** chatHistory flattened into the same shape the live transcript uses. */
  items: TranscriptItem[]
  transcript: PersistedTranscript | null
  error: string | null
  retry: () => void
}

const BACKOFF_MS = [1000, 2000, 4000, 8000]
const GIVE_UP_MS = 120_000

/** chatHistory entries vary in shape; normalise to the live transcript type. */
function toItems(t: PersistedTranscript | null): TranscriptItem[] {
  if (!t?.chatHistory?.length) return []
  return t.chatHistory.map((entry, i) => {
    const role = String(entry.role ?? entry.speaker ?? '').toLowerCase()
    return {
      id: `${t.sessionId}-${i}`,
      role: role === 'user' || role === 'human' ? 'user' : 'agent',
      text: String(entry.content ?? entry.text ?? entry.message ?? ''),
      final: true,
      timestamp: Date.parse(entry.timestamp ?? '') || i,
    }
  })
}

export function useTranscript(sessionId: string | null | undefined): UseTranscriptResult {
  const [status, setStatus] = useState<TranscriptStatus>('idle')
  const [transcript, setTranscript] = useState<PersistedTranscript | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)

  const retry = useCallback(() => {
    setStatus('idle')
    setTranscript(null)
    setError(null)
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!sessionId) {
      setStatus('idle')
      return
    }

    cancelledRef.current = false
    const startedAt = Date.now()
    let tries = 0

    setStatus('pending')
    setError(null)

    const poll = async () => {
      if (cancelledRef.current) return

      try {
        const result = await fetchTranscript(sessionId)
        if (cancelledRef.current) return

        if (result) {
          setTranscript(result)
          setStatus('ready')
          return
        }

        // Still being written. Keep waiting unless we have waited long enough
        // that something is genuinely wrong.
        if (Date.now() - startedAt > GIVE_UP_MS) {
          setStatus('timeout')
          return
        }
        const delay = BACKOFF_MS[Math.min(tries, BACKOFF_MS.length - 1)]
        tries += 1
        timerRef.current = setTimeout(poll, delay)
      } catch (e) {
        if (cancelledRef.current) return
        setError(e instanceof Error ? e.message : 'Failed to load the transcript')
        setStatus('error')
      }
    }

    void poll()

    return () => {
      cancelledRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [sessionId, attempt])

  return { status, items: toItems(transcript), transcript, error, retry }
}

export default useTranscript
