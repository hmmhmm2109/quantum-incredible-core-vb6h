'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { TranscriptItem } from '@/lib/voiceAgent'

export interface TranscriptViewProps {
  items: TranscriptItem[]
  autoScroll?: boolean
  emptyMessage?: string
  className?: string
  labels?: { user?: string; agent?: string }
}

export function TranscriptView({
  items,
  autoScroll = true,
  emptyMessage = 'The conversation will appear here.',
  className,
  labels,
}: TranscriptViewProps) {
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (autoScroll) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [items, autoScroll])

  if (!items.length) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{emptyMessage}</p>
  }

  return (
    <div
      className={cn('flex flex-col gap-3 overflow-y-auto', className)}
      aria-live="polite"
      aria-atomic="false"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={cn('flex flex-col gap-1', item.role === 'user' ? 'items-end' : 'items-start')}
        >
          <span className="text-xs font-medium text-muted-foreground">
            {item.role === 'user' ? labels?.user ?? 'You' : labels?.agent ?? 'Agent'}
          </span>
          <p
            className={cn(
              'max-w-[85%] rounded-lg px-3 py-2 text-sm',
              item.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted',
              !item.final && 'opacity-60'
            )}
          >
            {item.text}
          </p>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}

export default TranscriptView
