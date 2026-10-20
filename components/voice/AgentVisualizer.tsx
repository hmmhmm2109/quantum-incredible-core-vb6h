'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { AgentState } from '@/hooks/useVoiceSession'

export interface AgentVisualizerProps {
  analyser: AnalyserNode | null
  agentState?: AgentState
  bars?: number
  className?: string
  barClassName?: string
}

export function AgentVisualizer({
  analyser,
  agentState = 'unknown',
  bars = 24,
  className,
  barClassName,
}: AgentVisualizerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const elements = Array.from(container.children) as HTMLElement[]

    if (!analyser) {
      elements.forEach((el) => {
        el.style.transform = 'scaleY(0.08)'
      })
      return
    }

    const data = new Uint8Array(analyser.frequencyBinCount)
    const step = Math.max(1, Math.floor(data.length / elements.length))

    const draw = () => {
      analyser.getByteFrequencyData(data)
      elements.forEach((el, i) => {
        let sum = 0
        const from = i * step
        const to = Math.min(from + step, data.length)
        for (let j = from; j < to; j += 1) sum += data[j]
        const avg = sum / Math.max(1, to - from) / 255
        el.style.transform = `scaleY(${Math.max(0.08, avg)})`
      })
      frameRef.current = requestAnimationFrame(draw)
    }

    frameRef.current = requestAnimationFrame(draw)
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [analyser, bars])

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`Agent audio, ${agentState}`}
      className={cn('flex h-16 items-center justify-center gap-1', className)}
    >
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'h-full w-1 origin-center rounded-full bg-primary transition-transform duration-75',
            agentState === 'thinking' && 'animate-pulse',
            barClassName
          )}
          style={{ transform: 'scaleY(0.08)' }}
        />
      ))}
    </div>
  )
}

export default AgentVisualizer
