'use client'

import { cloneElement, isValidElement, useEffect, useState, type ComponentType } from 'react'
import { AlertCircle, ChevronDown, Headphones, Loader2, MessageCircle, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VoiceRoom } from '@/components/voice/VoiceRoom'
import { CallButton } from '@/components/voice/CallButton'
import { MicSelector } from '@/components/ui/mic-selector'
import { AgentVisualizer } from '@/components/voice/AgentVisualizer'
import { TranscriptView } from '@/components/voice/TranscriptView'
import { VoiceStatus } from '@/components/voice/VoiceStatus'
import { cn } from '@/lib/utils'
import { useVoiceSession, type VoiceState } from '@/hooks/useVoiceSession'

export interface VoiceSupportWidgetProps {
  agentId: string
  dynamicVariables?: Record<string, string>
  title?: string
  visualizer?: React.ReactNode
  maxCallSeconds?: number
  className?: string
}

function formatDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function launcherVisuals(state: VoiceState): {
  icon: ComponentType<{ className?: string }>
  spin: boolean
  ring: string
  dot: string
} {
  switch (state) {
    case 'connecting':
      return { icon: Loader2, spin: true, ring: 'ring-primary/40', dot: 'bg-primary animate-pulse' }
    case 'live':
      return { icon: Mic, spin: false, ring: 'ring-emerald-500/40', dot: 'bg-emerald-500' }
    case 'error':
      return { icon: AlertCircle, spin: false, ring: 'ring-destructive/40', dot: 'bg-destructive' }
    default:
      return { icon: MessageCircle, spin: false, ring: '', dot: '' }
  }
}

export function VoiceSupportWidget({
  agentId,
  dynamicVariables,
  title = 'Support Assistant',
  visualizer,
  maxCallSeconds,
  className,
}: VoiceSupportWidgetProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const call = useVoiceSession({ agentId, dynamicVariables })

  useEffect(() => {
    if (call.state !== 'live') return
    setElapsed(0)
    const id = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + 1
        if (maxCallSeconds && next >= maxCallSeconds) {
          call.hangup()
          return prev
        }
        return next
      })
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.state])

  const visuals = launcherVisuals(call.state)
  const LauncherIcon = visuals.icon
  const callIsLive = call.state === 'live' || call.state === 'connecting'

  const resolvedVisualizer = isValidElement(visualizer)
    ? cloneElement(visualizer as React.ReactElement<{ analyser?: AnalyserNode | null; agentState?: string }>, {
        analyser: call.analyser,
        agentState: call.agentState,
      })
    : (visualizer ?? <AgentVisualizer analyser={call.analyser} agentState={call.agentState} className="h-14" />)

  return (
    <>
      <VoiceRoom call={call} />

      <div className={cn('fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6', className)}>
        <div
          role="dialog"
          aria-label={title}
          aria-hidden={!isOpen}
          className={cn(
            'flex w-[min(92vw,380px)] origin-bottom-right flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl transition-all duration-200 ease-out',
            isOpen
              ? 'pointer-events-auto translate-y-0 scale-100 opacity-100'
              : 'pointer-events-none translate-y-3 scale-95 opacity-0'
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary">
                <Headphones className="h-4 w-4 text-primary-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">{title}</p>
                <p className="text-xs text-muted-foreground">
                  {callIsLive ? formatDuration(elapsed) : 'Voice · always available'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <VoiceStatus state={call.state} agentState={call.agentState} error={call.error} />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label="Collapse widget"
                onClick={() => setIsOpen(false)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-4 px-4 py-4">
            <div className="flex justify-center">{resolvedVisualizer}</div>

            <TranscriptView
              items={call.transcript}
              className="max-h-56 min-h-[6rem] pr-1"
              emptyMessage="Start the call and ask anything — the transcript appears here live."
            />
          </div>

          <div className="flex items-center justify-center gap-2 border-t border-border px-4 py-3">
            <CallButton state={call.state} onClick={call.toggle} className="flex-1" />
            <MicSelector
              muted={call.isMuted}
              onMutedChange={() => call.toggleMute()}
              onValueChange={call.setInputDevice}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label={callIsLive ? `Open ${title} — call in progress` : `Open ${title}`}
          className={cn(
            'group relative grid h-14 w-14 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-transparent transition-all duration-200 ease-out hover:scale-105',
            visuals.ring,
            isOpen ? 'pointer-events-none scale-75 opacity-0' : 'pointer-events-auto scale-100 opacity-100'
          )}
        >
          {callIsLive && (
            <span aria-hidden className="absolute inset-0 rounded-full bg-emerald-500/30 animate-ping" />
          )}
          <LauncherIcon className={cn('h-6 w-6', visuals.spin && 'animate-spin')} />
          {callIsLive && (
            <span
              aria-hidden
              className={cn('absolute right-0.5 top-0.5 h-3 w-3 rounded-full border-2 border-background', visuals.dot)}
            />
          )}
        </button>
      </div>
    </>
  )
}

export default VoiceSupportWidget
