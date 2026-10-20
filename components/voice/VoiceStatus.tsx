'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { AgentState, VoiceState } from '@/hooks/useVoiceSession'

export interface VoiceStatusProps {
  state: VoiceState
  agentState?: AgentState
  error?: string | null
  className?: string
}

const STATE_LABEL: Record<VoiceState, string> = {
  idle: 'Ready',
  connecting: 'Connecting…',
  live: 'Connected',
  ending: 'Ending…',
  ended: 'Call ended',
  error: 'Error',
}

const AGENT_LABEL: Partial<Record<AgentState, string>> = {
  initializing: 'Starting…',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
}

export function VoiceStatus({ state, agentState = 'unknown', error, className }: VoiceStatusProps) {
  if (state === 'error') {
    return (
      <Badge variant="destructive" className={className}>
        {error || STATE_LABEL.error}
      </Badge>
    )
  }

  const label =
    state === 'live' ? AGENT_LABEL[agentState] ?? STATE_LABEL.live : STATE_LABEL[state]

  return (
    <Badge
      variant={state === 'live' ? 'default' : 'secondary'}
      className={cn('gap-1.5', className)}
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full bg-current',
          (state === 'connecting' || state === 'ending' || agentState === 'thinking') &&
            'animate-pulse'
        )}
      />
      {label}
    </Badge>
  )
}

export default VoiceStatus
