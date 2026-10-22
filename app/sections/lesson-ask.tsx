'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CircleAlert, Loader2, MessageCircleQuestion, RefreshCw, TerminalSquare } from 'lucide-react'
import { useAuth } from 'lyzr-architect-pg/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useAiProvider } from '@/hooks/use-ai-provider'

// One saved question and Claude's answer, as returned by /api/lesson/ask.
export type LessonQuestion = {
  id: string
  variant: string | null
  section_index: number | null
  section_title: string | null
  question: string
  answer: string
  gap: { is_gap: boolean; summary: string; missing_prerequisite: string | null }
  resolved: boolean
  folded?: boolean
  served_by?: string | null
}

const MAX_QUESTION_CHARS = 1500

// Loads the learner's saved questions for a topic (again whenever `reloadKey` changes, e.g. after the lecture was adapted) and asks new ones.
export function useLessonQuestions(domainId: string, topicId: string, reloadKey: unknown) {
  const { authFetch } = useAuth()
  const [items, setItems] = useState<LessonQuestion[]>([])
  const [openGaps, setOpenGaps] = useState(0)
  const [hasAdapted, setHasAdapted] = useState(false)
  const [adaptedStale, setAdaptedStale] = useState(false)
  const [foldedCount, setFoldedCount] = useState(0)
  useEffect(() => {
    let current = true
    void (async () => {
      try {
        const response = await authFetch(`/api/lesson/ask?domain_id=${domainId}&topic_id=${topicId}`)
        const body = await response.json().catch(() => null)
        if (!current || !response.ok || body?.success !== true) return
        setItems(body.data.items); setOpenGaps(body.data.new_gap_count ?? body.data.open_gaps ?? 0); setHasAdapted(body.data.has_adapted); setAdaptedStale(body.data.adapted_stale === true); setFoldedCount(body.data.folded_count ?? 0)
      } catch { /* saved questions are optional; asking a new one still works */ }
    })()
    return () => { current = false }
  }, [authFetch, domainId, topicId, reloadKey])
  // Throws an Error with a learner-readable message; the caller keeps the text so the learner can retry.
  const ask = useCallback(async (sectionIndex: number | null, question: string, variant: string | null) => {
    const response = await authFetch('/api/lesson/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain_id: domainId, topic_id: topicId, section_index: sectionIndex, question, ...(variant && { variant }) }) })
    const body = await response.json().catch(() => null)
    if (!response.ok || body?.success !== true) throw new Error(typeof body?.error === 'string' ? body.error : 'The AI provider could not answer this question.')
    const item = body.data as LessonQuestion
    setItems((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item])
    if (item.gap.is_gap) { setOpenGaps((count) => count + 1); setAdaptedStale(true) }
  }, [authFetch, domainId, topicId])
  return { items, openGaps, hasAdapted, adaptedStale, foldedCount, ask }
}

export function QuestionThread({ items, render }: { items: LessonQuestion[]; render: (text: string) => ReactNode }) {
  if (items.length === 0) return null
  return <div className="space-y-3" aria-label="Your questions">{items.map((item) => <div key={item.id} className="space-y-2 rounded-xl border border-border/70 bg-background p-3">
    <div className="flex flex-wrap items-start gap-2"><p className="min-w-0 flex-1 text-sm font-medium leading-6">{item.question}</p>{item.gap.is_gap && <Badge variant="outline" className="rounded-full border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-800 dark:text-amber-300"><span>{item.folded || item.resolved ? 'Gap noted · in lesson' : 'Gap noted'}</span></Badge>}</div>
    <div className="text-muted-foreground">{render(item.answer)}</div>
    {item.served_by && <div className="font-mono text-[10px] text-muted-foreground/80">Answered by {item.served_by}</div>}
    {item.gap.is_gap && item.gap.summary && <div className="space-y-1 text-xs text-muted-foreground"><div className="font-semibold text-foreground">What was unclear:</div>{render(item.gap.summary)}{item.gap.missing_prerequisite && <p>Missing background: {item.gap.missing_prerequisite}.</p>}</div>}
  </div>)}</div>
}

// Collapsed "Ask about this" button that opens an inline question box. `title` is the section the question is scoped to (null = whole lesson, always open).
// `prefill` (general box only) fills the text once and focuses the box, e.g. when the learner arrives from a wrong assessment answer; `onPrefilled` tells the parent it was applied.
export function AskBox({ title, sectionIndex, variant, ask, prefill, onPrefilled }: { title: string | null; sectionIndex: number | null; variant: string | null; ask: (sectionIndex: number | null, question: string, variant: string | null) => Promise<void>; prefill?: string | null; onPrefilled?: () => void }) {
  const ai = useAiProvider()
  const general = sectionIndex === null
  const [open, setOpen] = useState(general)
  const [text, setText] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!general || !prefill) return
    setText((current) => current.trim() ? current : prefill)
    onPrefilled?.()
    requestAnimationFrame(() => { const box = document.getElementById('lesson-general-question') as HTMLTextAreaElement | null; box?.scrollIntoView({ behavior: 'smooth', block: 'center' }); box?.focus({ preventScroll: true }); box?.setSelectionRange(box.value.length, box.value.length) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])
  const submit = async () => {
    if (!text.trim() || asking) return
    setAsking(true); setError(null)
    try { await ask(sectionIndex, text.trim(), variant); setText(''); if (!general) setOpen(false) } catch (caught) { setError(caught instanceof Error ? caught.message : 'The AI provider could not be reached.') } finally { setAsking(false) }
  }
  if (!open) return <Button onClick={() => setOpen(true)} variant="ghost" size="sm" className="min-h-10 gap-2 rounded-xl text-primary"><MessageCircleQuestion className="h-4 w-4" />Ask about this</Button>
  return <div className="space-y-2 rounded-xl border border-primary/25 bg-primary/[0.03] p-3">
    <div className="flex items-center gap-2 text-xs font-semibold"><MessageCircleQuestion className="h-4 w-4 text-primary" />{general ? <span>Ask a question about this lesson</span> : <><span>Asking about: </span><span className="font-normal text-muted-foreground">{title}</span></>}</div>
    <Textarea id={general ? 'lesson-general-question' : undefined} value={text} onChange={(event) => setText(event.target.value)} maxLength={MAX_QUESTION_CHARS} disabled={asking} aria-label={general ? 'Your question about this lesson' : `Your question about ${title}`} className="min-h-20 rounded-xl text-sm" placeholder={general ? 'What is unclear? e.g. explain this in more depth, or what does X mean…' : 'What is unclear in this part? Name the term or step…'} />
    <div className="flex flex-wrap items-center gap-2"><Button onClick={() => void submit()} disabled={!text.trim() || asking} size="sm" className="min-h-10 gap-2 rounded-xl">{asking && <Loader2 className="h-4 w-4 animate-spin" />}<span>{asking ? 'Asking…' : 'Ask'}</span></Button>{!general && !asking && <Button onClick={() => setOpen(false)} variant="ghost" size="sm" className="min-h-10 rounded-xl">Cancel</Button>}{asking && <span className="text-xs text-muted-foreground" role="status">{ai.short} is answering, this can take up to a minute.</span>}</div>
    {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><TerminalSquare className="mt-0.5 h-4 w-4 shrink-0" /><span><span className="font-semibold">Your question could not be answered.</span> {error.replace(/[.!?]?$/, '.')} Your text is kept; press Ask to try again.</span></div>}
  </div>
}

// Offers to fold the NEW unclear points (gaps not yet in the enriched lecture) into the lesson; after that the banner disappears.
export function AdaptBar({ newGaps, hasAdapted, busy, onAdapt }: { newGaps: number; hasAdapted: boolean; busy: boolean; onAdapt: () => void }) {
  const ai = useAiProvider()
  if (newGaps === 0 && !busy) return null
  return <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm" role="status">
    {busy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-700 dark:text-amber-400" /> : <CircleAlert className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />}
    <span className="min-w-[12rem] flex-1">{busy ? `${ai.short} is working your questions into the lesson, this can take a minute or two.` : `${newGaps} new unclear ${newGaps === 1 ? 'point' : 'points'} can be added to this lesson.`}</span>
    <Button onClick={onAdapt} disabled={busy} variant="outline" size="sm" className="min-h-10 gap-2 rounded-xl"><RefreshCw className="h-4 w-4" /><span>{hasAdapted ? 'Update enriched lesson' : 'Add to lesson'}</span></Button>
  </div>
}
