'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { AgentState } from '@/hooks/useVoiceSession'
import type { PersonaProps, PersonaState } from '@/components/ui/persona'
import { Spinner } from '@/components/ui/spinner'

const Persona = dynamic(() => import('@/components/ui/persona').then((m) => m.Persona), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-full bg-primary/10">
      <Spinner className="size-6 text-primary" />
    </div>
  ),
})

export interface AgentOrbProps extends Omit<PersonaProps, 'state' | 'className'> {
  analyser?: AnalyserNode | null
  agentState?: AgentState
  size?: number
  className?: string
}

function toPersonaState(agentState: AgentState, isLoud: boolean): PersonaState {
  switch (agentState) {
    case 'initializing':
      return 'thinking'
    case 'thinking':
      return 'thinking'
    case 'speaking':
      return 'speaking'
    case 'listening':
      return isLoud ? 'speaking' : 'listening'
    default:
      return isLoud ? 'listening' : 'idle'
  }
}

export function AgentOrb({ analyser = null, agentState = 'unknown', size = 128, className, ...personaProps }: AgentOrbProps) {
  const [isLoud, setIsLoud] = useState(false)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    if (!analyser) {
      setIsLoud(false)
      return
    }

    const data = new Uint8Array(analyser.frequencyBinCount)
    const draw = () => {
      analyser.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < data.length; i += 1) sum += data[i]
      setIsLoud(sum / data.length / 255 > 0.08)
      frameRef.current = requestAnimationFrame(draw)
    }

    frameRef.current = requestAnimationFrame(draw)
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [analyser])

  return (
    <div
      role="img"
      aria-label={`Agent audio, ${agentState}`}
      className={cn('flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <Persona {...personaProps} state={toPersonaState(agentState, isLoud)} className="h-full w-full" />
    </div>
  )
}

export default AgentOrb
