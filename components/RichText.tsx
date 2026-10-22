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

export type TextSegment = { kind: 'text' | 'code'; text: string; lang?: string }

/** Splits on ``` fences over the FULL text (before any paragraph/line split). Tolerates a fence glued to text on the same
 *  line, a language tag, and a missing closing fence (the rest becomes code). */
export function splitFences(text: string): TextSegment[] {
  const out: TextSegment[] = []
  const parts = text.split('```')
  parts.forEach((part, index) => {
    if (index % 2 === 0) { if (part.trim()) out.push({ kind: 'text', text: part }); return }
    const match = /^([A-Za-z0-9+#_-]*)[ \t]*\r?\n/.exec(part)
    const lang = match?.[1] || undefined
    const code = (match ? part.slice(match[0].length) : part).replace(/\s+$/, '')
    if (code.trim()) out.push({ kind: 'code', text: code, lang })
  })
  return out
}

export const CODE_BLOCK_CLASS = 'overflow-x-auto rounded-xl bg-muted/70 p-3 font-mono text-xs leading-5 text-foreground'

export type ProseBlock = { kind: 'p'; text: string } | { kind: 'ol' | 'ul'; items: string[] }

// Same length as `text`, with the inside of `code` spans blanked, so list markers inside code are never matched.
const maskCode = (text: string) => text.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))

/** "lead (1) a; (2) b; (3) c. Tail sentence." -> lead + items + tail. Needs sequential markers (1), (2) ... (at least 2). */
export function splitEnumeration(text: string): { lead: string; items: string[]; tail: string } | null {
  const masked = maskCode(text)
  const found: { index: number; length: number }[] = []
  let want = 1
  for (const m of masked.matchAll(/\((\d{1,2})\)/g)) {
    if (Number(m[1]) === want) { found.push({ index: m.index!, length: m[0].length }); want += 1 }
  }
  if (found.length < 2) return null
  const lead = text.slice(0, found[0].index).trim()
  const items = found.map((f, i) => text.slice(f.index + f.length, i + 1 < found.length ? found[i + 1].index : text.length).trim())
  let tail = ''
  // The last item runs to the end of the text: a following sentence ("Add a short comment...") is not part of it.
  const last = items[items.length - 1]
  const cut = [...maskCode(last).matchAll(/[.!?]\s+(?=[A-Z])/g)].find((m) => !/\b(e\.g|i\.e|vs|etc)\.$/i.test(last.slice(0, m.index! + 1)))
  if (cut) { tail = last.slice(cut.index! + cut[0].length).trim(); items[items.length - 1] = last.slice(0, cut.index! + 1).trim() }
  return { lead, items: items.map((item) => item.replace(/[;,]?\s*(?:and|or)?\s*$/i, (m) => /(?:and|or)/i.test(m) ? '' : '').replace(/[;,]\s*$/, '').trim()).filter(Boolean), tail }
}

/** Paragraphs (blank-line separated); runs of "1. a" / "- a" lines become lists; a paragraph with inline "(1) ... (2) ..." becomes lead + list + tail. */
export function proseBlocks(text: string): ProseBlock[] {
  const out: ProseBlock[] = []
  const pushPara = (para: string) => {
    const e = splitEnumeration(para)
    if (!e) { out.push({ kind: 'p', text: para }); return }
    if (e.lead) out.push({ kind: 'p', text: e.lead })
    out.push({ kind: 'ol', items: e.items })
    if (e.tail) out.push({ kind: 'p', text: e.tail })
  }
  for (const para of text.split(/\n\s*\n/)) {
    const lines = para.split('\n')
    let buf: string[] = []
    let list: { kind: 'ol' | 'ul'; items: string[] } | null = null
    const flushText = () => { if (buf.length) { const t = buf.join('\n').trim(); if (t) pushPara(t); buf = [] } }
    const flushList = () => { if (list) { out.push(list); list = null } }
    for (const line of lines) {
      const num = /^\s*\d{1,2}[.)]\s+(.*\S)\s*$/.exec(line)
      const bul = /^\s*[-*•]\s+(.*\S)\s*$/.exec(line)
      const kind = num ? 'ol' : bul ? 'ul' : null
      if (kind) {
        flushText()
        if (list && list.kind !== kind) flushList()
        if (!list) list = { kind, items: [] }
        list.items.push((num ?? bul)![1])
      } else if (list && /^\s+\S/.test(line)) list.items[list.items.length - 1] += ` ${line.trim()}`
      else { flushList(); buf.push(line) }
    }
    flushList(); flushText()
  }
  return out
}

// Prose with optional ``` fenced code listings, `inline code`, paragraphs and lists (numbered lines, bullets, or an inline "(1) ... (2) ..." enumeration).
export function PromptText({ text, className }: { text: string; className?: string }) {
  return <div className={`space-y-2 ${className ?? ''}`}>{splitFences(text).map((segment, index) => segment.kind === 'code'
    ? <pre key={index} translate="no" className={CODE_BLOCK_CLASS}>{segment.text}</pre>
    : <div key={index} className="space-y-2">{proseBlocks(segment.text.trim()).map((block, bi) => block.kind === 'p'
      ? <p key={bi} className="whitespace-pre-wrap text-sm leading-6"><InlineText text={block.text} /></p>
      : block.kind === 'ol'
        ? <ol key={bi} className="list-decimal space-y-1.5 pl-5 text-sm leading-6 marker:text-muted-foreground">{block.items.map((item, ii) => <li key={ii}><InlineText text={item} /></li>)}</ol>
        : <ul key={bi} className="list-disc space-y-1.5 pl-5 text-sm leading-6 marker:text-muted-foreground">{block.items.map((item, ii) => <li key={ii}><InlineText text={item} /></li>)}</ul>)}</div>)}</div>
}
