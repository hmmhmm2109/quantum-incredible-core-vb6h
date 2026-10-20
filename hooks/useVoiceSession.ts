'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Room } from 'livekit-client'
import {
  endVoiceSession,
  startVoiceSession,
  TranscriptItem,
  VoiceSession,
} from '@/lib/voiceAgent'

export type VoiceState = 'idle' | 'connecting' | 'live' | 'ending' | 'ended' | 'error'

export type AgentState = 'initializing' | 'listening' | 'thinking' | 'speaking' | 'unknown'

export interface VoiceSegment {
  id: string
  text: string
  final: boolean
}

export interface VoiceConnection {
  room: Room | null
  session: VoiceSession | null
  shouldConnect: boolean
  onConnected: () => void
  onDisconnected: () => void
  onError: (error: Error) => void
  setAgentState: (next: AgentState) => void
  setAnalyser: (next: AnalyserNode | null) => void
  mergeSegments: (role: TranscriptItem['role'], segments: VoiceSegment[]) => void
}

export interface UseVoiceSessionOptions {
  agentId?: string
  dynamicVariables?: Record<string, string>
  userIdentity?: string
  onEnded?: (sessionId: string) => void
  onError?: (error: Error) => void
}

export interface UseVoiceSessionResult {
  state: VoiceState
  error: string | null
  sessionId: string | null
  roomName: string | null
  transcript: TranscriptItem[]
  agentState: AgentState
  isMuted: boolean
  analyser: AnalyserNode | null
  connect: () => Promise<void>
  hangup: () => Promise<void>
  toggleMute: () => void
  toggle: () => void
  setInputDevice: (deviceId: string) => Promise<void>
  connection: VoiceConnection
}

export function useVoiceSession(options: UseVoiceSessionOptions = {}): UseVoiceSessionResult {
  const { agentId, dynamicVariables, userIdentity, onEnded, onError } = options

  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<VoiceSession | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [shouldConnect, setShouldConnect] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptItem[]>([])
  const [agentState, setAgentState] = useState<AgentState>('unknown')
  const [isMuted, setIsMuted] = useState(true)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)

  const roomRef = useRef<Room | null>(null)
  const stateRef = useRef<VoiceState>(state)
  stateRef.current = state
  const isMutedRef = useRef(isMuted)
  isMutedRef.current = isMuted
  const preferredDeviceIdRef = useRef<string | null>(null)
  const teardownRef = useRef<() => void>(() => {})

  const mergeSegments = useCallback(
    (role: TranscriptItem['role'], segments: VoiceSegment[]) => {
      if (segments.length === 0) return
      setTranscript((prev) => {
        const byId = new Map(prev.map((item) => [item.id, item]))
        let changed = false

        for (const segment of segments) {
          const existing = byId.get(segment.id)
          if (existing && existing.text === segment.text && existing.final === segment.final) {
            continue
          }
          byId.set(segment.id, {
            id: segment.id,
            role,
            text: segment.text,
            final: segment.final,
            timestamp: existing?.timestamp ?? Date.now(),
          })
          changed = true
        }

        return changed ? [...byId.values()].sort((a, b) => a.timestamp - b.timestamp) : prev
      })
    },
    []
  )

  const connect = useCallback(async () => {
    if (stateRef.current === 'connecting' || stateRef.current === 'live') return

    setState('connecting')
    setError(null)
    setTranscript([])
    setAgentState('initializing')

    try {
      const started = await startVoiceSession({ agentId, dynamicVariables, userIdentity })

      const next = new Room({ adaptiveStream: true, dynacast: true })
      roomRef.current = next

      if (preferredDeviceIdRef.current) {
        await next.switchActiveDevice('audioinput', preferredDeviceIdRef.current).catch(() => {})
      }

      setRoom(next)
      setSession(started)
      setShouldConnect(true)
    } catch (cause) {
      const err = cause instanceof Error ? cause : new Error('Failed to start the call')
      setShouldConnect(false)
      setError(err.message)
      setState('error')
      onError?.(err)
    }
  }, [agentId, dynamicVariables, userIdentity, onError])

  const hangup = useCallback(async () => {
    if (state !== 'live' && state !== 'connecting') return

    setState('ending')
    setShouldConnect(false)

    if (session?.roomName) {
      try {
        await endVoiceSession(session.roomName)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Failed to end the session cleanly')
      }
    }

    setAgentState('unknown')
    setAnalyser(null)
    setState('ended')
    if (session?.sessionId) onEnded?.(session.sessionId)
  }, [state, session, onEnded])

  const toggleMute = useCallback(() => {
    const next = !isMuted
    setIsMuted(next)
    roomRef.current?.localParticipant.setMicrophoneEnabled(!next).catch(() => {})
  }, [isMuted])

  const setInputDevice = useCallback(async (deviceId: string) => {
    preferredDeviceIdRef.current = deviceId
    await roomRef.current?.switchActiveDevice('audioinput', deviceId)
  }, [])

  const toggle = useCallback(() => {
    if (state === 'live' || state === 'connecting') void hangup()
    else void connect()
  }, [state, connect, hangup])

  const onConnected = useCallback(() => {
    setState((prev) => (prev === 'connecting' ? 'live' : prev))
    roomRef.current?.localParticipant.setMicrophoneEnabled(!isMutedRef.current).catch(() => {})
  }, [])

  const onDisconnected = useCallback(() => {
    setAgentState('unknown')
    setAnalyser(null)
    setState((prev) => (prev === 'live' ? 'ended' : prev))
  }, [])

  const onRoomError = useCallback(
    (err: Error) => {
      setShouldConnect(false)
      setError(err.message)
      setState('error')
      onError?.(err)
    },
    [onError]
  )

  teardownRef.current = () => {
    const roomName = session?.roomName
    roomRef.current?.disconnect().catch(() => {})
    roomRef.current = null
    if (roomName) void endVoiceSession(roomName).catch(() => {})
  }

  useEffect(() => () => teardownRef.current(), [])

  return {
    state,
    error,
    sessionId: session?.sessionId ?? null,
    roomName: session?.roomName ?? null,
    transcript,
    agentState,
    isMuted,
    analyser,
    connect,
    hangup,
    toggleMute,
    toggle,
    setInputDevice,
    connection: {
      room,
      session,
      shouldConnect,
      onConnected,
      onDisconnected,
      onError: onRoomError,
      setAgentState,
      setAnalyser,
      mergeSegments,
    },
  }
}

export default useVoiceSession
