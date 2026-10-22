import type { ReactNode } from 'react'

// Shared renderer for model-written prose: `inline code` spans (padding inside the backticks is trimmed), **bold**,
// and (PromptText) ``` fenced blocks. Builds React nodes only, never raw HTML.
const CODE_CLASS = 'rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground'

export function InlineText({ text }: { text: string }): ReactNode {
  if (!text) return null
  if (!text.includes('`') && !text.includes('**')) return <span>{text}</span>
  return <span>{text.split(/(`[^`\n]+`)/g).map((part, index) => {
    if (index % 2 === 1) return <code key={index} translate="no" className={CODE_CLASS}>{part.slice(1, -1).trim()}</code>
    const bold = part.split(/\*\*(.+?)\*\*/g)
    return bold.length === 1 ? <span key={index}>{part}</span> : bold.map((piece, i) => i % 2 === 1 ? <strong key={`${index}-${i}`} className="font-semibold">{piece}</strong> : <span key={`${index}-${i}`}>{piece}</span>)
  })}</span>
}

// Prose with optional ``` fenced code listings; line breaks of the prose are kept.
export function PromptText({ text, className }: { text: string; className?: string }) {
  return <div className={`space-y-2 ${className ?? ''}`}>{text.split(/```[a-zA-Z0-9+-]*\n?/).map((part, index) => index % 2 === 1
    ? <pre key={index} translate="no" className="overflow-x-auto rounded-xl bg-muted/70 p-3 font-mono text-xs leading-5 text-foreground">{part.replace(/\n$/, '')}</pre>
    : part.trim() ? <p key={index} className="whitespace-pre-wrap text-sm leading-6"><InlineText text={part.trim()} /></p> : null)}</div>
}
