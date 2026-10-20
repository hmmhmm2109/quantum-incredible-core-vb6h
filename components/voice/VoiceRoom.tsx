'use client'

import { useEffect, useRef } from 'react'
import { Track } from 'livekit-client'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useTrackTranscription,
  useTracks,
  useVoiceAssistant,
} from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'

import type { AgentState, UseVoiceSessionResult, VoiceConnection } from '@/hooks/useVoiceSession'

const BACKGROUND_AUDIO_TRACK = 'background_audio'

const AGENT_STATE_MAP: Record<string, AgentState> = {
  initializing: 'initializing',
  connecting: 'initializing',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  disconnected: 'unknown',
}

function BackgroundAudioRenderer() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const tracks = useTracks([Track.Source.Unknown], { onlySubscribed: true })
  const track = tracks.find((t) => t.publication?.trackName === BACKGROUND_AUDIO_TRACK)
    ?.publication?.track

  useEffect(() => {
    if (!track) {
      if (audioRef.current) audioRef.current.srcObject = null
      return
    }

    if (!audioRef.current) {
      const el = document.createElement('audio')
      el.autoplay = true
      el.volume = 1
      el.setAttribute('playsinline', 'true')
      document.body.appendChild(el)
      audioRef.current = el
    }

    const element = audioRef.current
    track.attach(element)
    return () => {
      track.detach(element)
    }
  }, [track])

  useEffect(
    () => () => {
      audioRef.current?.remove()
      audioRef.current = null
    },
    []
  )

  return null
}

function AgentStateBridge({
  agentAudioTrack,
  connection,
}: {
  agentAudioTrack: TrackReferenceOrPlaceholder | undefined
  connection: VoiceConnection
}) {
  const { state } = useVoiceAssistant()
  const { setAgentState, setAnalyser } = connection
  const mediaStreamTrack = agentAudioTrack?.publication?.track?.mediaStreamTrack

  useEffect(() => {
    setAgentState(AGENT_STATE_MAP[state] ?? 'unknown')
  }, [state, setAgentState])

  useEffect(() => {
    if (!mediaStreamTrack) {
      setAnalyser(null)
      return
    }

    let context: AudioContext | null = null
    try {
      context = new AudioContext()
      const node = context.createAnalyser()
      node.fftSize = 256
      node.smoothingTimeConstant = 0.8
      context.createMediaStreamSource(new MediaStream([mediaStreamTrack])).connect(node)
      if (context.state === 'suspended') void context.resume()
      setAnalyser(node)
    } catch {
      setAnalyser(null)
      return
    }

    return () => {
      setAnalyser(null)
      context?.close().catch(() => {})
    }
  }, [mediaStreamTrack, setAnalyser])

  return null
}

function TranscriptBridge({
  agentAudioTrack,
  connection,
}: {
  agentAudioTrack: TrackReferenceOrPlaceholder | undefined
  connection: VoiceConnection
}) {
  const { localParticipant, microphoneTrack } = useLocalParticipant()
  const { mergeSegments } = connection

  const agent = useTrackTranscription(agentAudioTrack)
  const local = useTrackTranscription({
    publication: microphoneTrack,
    source: Track.Source.Microphone,
    participant: localParticipant,
  })

  useEffect(() => {
    mergeSegments('agent', agent.segments)
  }, [agent.segments, mergeSegments])

  useEffect(() => {
    mergeSegments('user', local.segments)
  }, [local.segments, mergeSegments])

  return null
}

function VoiceRoomInner({ connection }: { connection: VoiceConnection }) {
  const { audioTrack } = useVoiceAssistant()

  return (
    <>
      <RoomAudioRenderer />
      <BackgroundAudioRenderer />
      <AgentStateBridge agentAudioTrack={audioTrack} connection={connection} />
      <TranscriptBridge agentAudioTrack={audioTrack} connection={connection} />
    </>
  )
}

export interface VoiceRoomProps {
  call: UseVoiceSessionResult
}

export function VoiceRoom({ call }: VoiceRoomProps) {
  const { connection } = call
  const { room, session } = connection

  if (!room || !session) return null

  return (
    <LiveKitRoom
      room={room}
      serverUrl={session.livekitUrl}
      token={session.userToken}
      connect={connection.shouldConnect}
      audio={true}
      video={false}
      onConnected={connection.onConnected}
      onDisconnected={connection.onDisconnected}
      onError={connection.onError}
      style={{ display: 'contents' }}
    >
      <VoiceRoomInner connection={connection} />
    </LiveKitRoom>
  )
}

export default VoiceRoom
