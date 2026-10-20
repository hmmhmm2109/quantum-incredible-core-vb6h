'use client'

import { Loader2, Mic, MicOff, Phone, PhoneOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { VoiceState } from '@/hooks/useVoiceSession'

export interface CallButtonProps {
  state: VoiceState
  onClick: () => void
  variant?: 'call' | 'mute'
  isMuted?: boolean
  className?: string
  labels?: Partial<Record<'start' | 'connecting' | 'end' | 'ending', string>>
}

export function CallButton({
  state,
  onClick,
  variant = 'call',
  isMuted = false,
  className,
  labels,
}: CallButtonProps) {
  if (variant === 'mute') {
    return (
      <Button
        type="button"
        onClick={onClick}
        disabled={state !== 'live'}
        variant={isMuted ? 'secondary' : 'outline'}
        size="icon"
        aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
        aria-pressed={isMuted}
        className={className}
      >
        {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </Button>
    )
  }

  const busy = state === 'connecting' || state === 'ending'
  const active = state === 'live' || state === 'ending'

  const label = busy
    ? state === 'connecting'
      ? labels?.connecting ?? 'Connecting…'
      : labels?.ending ?? 'Ending…'
    : active
      ? labels?.end ?? 'End call'
      : labels?.start ?? 'Start call'

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={busy}
      variant={active ? 'destructive' : 'default'}
      aria-label={label}
      className={cn('gap-2', className)}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : active ? (
        <PhoneOff className="h-4 w-4" />
      ) : (
        <Phone className="h-4 w-4" />
      )}
      {label}
    </Button>
  )
}

export default CallButton
