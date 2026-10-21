'use client'

import { useState } from 'react'
import { ArrowRight, BookOpen, Check, ChevronDown, ChevronUp, CircleAlert, Loader2, MessageSquareText, Play, RefreshCw, Sparkles, Target, TerminalSquare } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { ReviewData } from '@/app/sections/result-section'

type TopicRef = { id: string; label: string }

type LessonSectionProps = {
  data: ReviewData | null
  status: 'loading' | 'ready' | 'error'
  error: string | null
  domainLabel: string
  topicLabel: string
  subtopics: string[]
  prerequisites: TopicRef[]
  missingPrerequisites: TopicRef[]
  nextTopic: TopicRef | null
  learnState: 'none' | 'learned' | 'assessed'
  variantLabel: string | null
  practiceStatus: 'loading' | 'ready' | 'error'
  busy: boolean
  marking: boolean
  retrievalFeedback: string | null
  onBack: () => void
  onRetry: () => void
  onAction: (action: string) => void
  onShowOriginal: () => void
  onRegenerate: () => void
  onMarkLearned: () => void
  onNextTopic: () => void
  onOpenTopic: (topicId: string) => void
  onStartPractice: () => void
  onRetryPractice: () => void
  onRetrievalSubmit: (answer: string) => void
}

// Lecture actions: label shown to the learner -> `action` value accepted by POST /api/lesson.
const ACTIONS: { label: string; action: string }[] = [
  { label: 'Explain more', action: 'explain-more' },
  { label: 'Make it shorter', action: 'shorter' },
  { label: 'Show another example', action: 'another-example' },
  { label: 'Review prerequisites', action: 'prerequisites' },
]

function renderMarkdown(text: string) {
  if (!text) return null
  const inline = (value: string) => { const parts = value.split(/\*\*(.*?)\*\*/g); return parts.length === 1 ? value : parts.map((part, index) => index % 2 === 1 ? <strong key={index} className="font-semibold">{part}</strong> : part) }
  return <div className="space-y-2">{text.split('\n').map((line, index) => { if (line.startsWith('### ')) return <h4 key={index} className="mt-3 text-sm font-semibold">{line.slice(4)}</h4>; if (line.startsWith('## ')) return <h3 key={index} className="mt-3 text-base font-semibold">{line.slice(3)}</h3>; if (line.startsWith('# ')) return <h2 key={index} className="mt-4 text-lg font-bold">{line.slice(2)}</h2>; if (line.startsWith('- ') || line.startsWith('* ')) return <li key={index} className="ml-4 list-disc text-sm">{inline(line.slice(2))}</li>; if (/^\d+\.\s/.test(line)) return <li key={index} className="ml-4 list-decimal text-sm">{inline(line.replace(/^\d+\.\s/, ''))}</li>; if (!line.trim()) return <div key={index} className="h-1" />; return <p key={index} className="text-sm leading-6">{inline(line)}</p> })}</div>
}
// Claude sometimes numbers its section titles itself; the list adds its own number, so drop a leading "1. " / "2) ".
const stripNumber = (title: string) => title.replace(/^\s*\d+[.)]\s+/, '')

export default function LessonSection(props: LessonSectionProps) {
  const { data, status, error, domainLabel, topicLabel, subtopics, prerequisites, missingPrerequisites, nextTopic, learnState, variantLabel, practiceStatus, busy, marking, retrievalFeedback } = props
  const [retrievalAnswer, setRetrievalAnswer] = useState('')
  const [openSections, setOpenSections] = useState<number[]>([0])
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const toggleSection = (index: number) => setOpenSections((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index])
  const lecture = data?.lecture
  const practiceButton = <Button onClick={props.onStartPractice} disabled={practiceStatus !== 'ready'} className="min-h-11 gap-2 rounded-xl active:scale-[0.98] transition-transform">{practiceStatus === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{practiceStatus === 'loading' ? 'Preparing exercise…' : 'Start practice'}</Button>
  return <div className="mx-auto w-full max-w-4xl space-y-6 pb-10">
    <div className="border-b border-border/70 pb-6">
      <button onClick={props.onBack} className="mb-3 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowRight className="h-4 w-4 rotate-180" />Back to home</button>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary"><span className="h-px w-6 bg-primary" />Lesson · {domainLabel}</div>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="font-serif text-4xl tracking-tight text-balance">{topicLabel}</h1>
        {status === 'ready' && <div className="flex shrink-0 flex-wrap gap-2">{practiceButton}<Button onClick={() => setConfirmRegenerate(true)} disabled={busy} variant="outline" className="min-h-11 gap-2 rounded-xl"><RefreshCw className="h-4 w-4" />Regenerate</Button></div>}
      </div>
      <div className="mt-4 space-y-2 text-xs text-muted-foreground">
        {prerequisites.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="font-semibold text-foreground">Prerequisites</span>{prerequisites.map((item) => <Badge key={item.id} variant="secondary" className="rounded-full text-[10px]">{item.label}</Badge>)}</div>}
        {subtopics.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="font-semibold text-foreground">Covers</span>{subtopics.map((item) => <Badge key={item} variant="outline" className="rounded-full text-[10px] font-normal">{item}</Badge>)}</div>}
      </div>
      {missingPrerequisites.length > 0 && <div role="status" className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm"><CircleAlert className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" /><span><span className="font-semibold">Recommended first:</span> {missingPrerequisites.map((item) => item.label).join(', ')}. You can continue with this lesson anyway.</span>{missingPrerequisites.map((item) => <Button key={item.id} onClick={() => props.onOpenTopic(item.id)} variant="outline" size="sm" className="rounded-xl">Open {item.label}</Button>)}</div>}
    </div>

    {status === 'loading' && <Card className="rounded-3xl border-border/70 shadow-sm" role="status" aria-live="polite"><CardContent className="space-y-5 p-6 sm:p-8"><div className="flex items-center gap-3"><Loader2 className="h-6 w-6 animate-spin text-primary" /><div><div className="font-semibold">Preparing lesson…</div><p className="text-sm text-muted-foreground">This can take 30–60s on first generation. Lessons you opened before load instantly.</p></div></div><Skeleton className="h-6 w-2/3 rounded-lg" /><Skeleton className="h-4 w-full rounded-lg" /><Skeleton className="h-4 w-full rounded-lg" /><Skeleton className="h-4 w-5/6 rounded-lg" /><Skeleton className="h-12 w-full rounded-2xl" /><Skeleton className="h-12 w-full rounded-2xl" /></CardContent></Card>}

    {status === 'error' && <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><TerminalSquare className="mt-0.5 h-4 w-4 shrink-0" /><div><span className="font-semibold">The lesson could not be prepared.</span> {error}</div></div><Button onClick={props.onRetry} variant="outline" className="min-h-10 shrink-0 gap-2 rounded-xl"><RefreshCw className="h-4 w-4" />Retry</Button></div>}

    {status === 'ready' && data && lecture && <>
      <Card className="rounded-3xl border-primary/20 bg-primary/[0.035] shadow-sm"><CardContent className="space-y-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2"><Badge className="rounded-full">{lecture.selected_depth.replaceAll('_', ' ')}</Badge><Badge variant="outline" className="rounded-full">{lecture.estimated_duration_minutes} minute lesson</Badge>{variantLabel && <Badge variant="secondary" className="gap-1.5 rounded-full">{variantLabel}<button onClick={props.onShowOriginal} disabled={busy} className="underline underline-offset-2 disabled:opacity-50">Show original</button></Badge>}</div>
        {lecture.selection_reason && <p className="text-sm leading-6 text-muted-foreground">{lecture.selection_reason}</p>}
        <div><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Target className="h-4 w-4 text-primary" />Learning objectives</div><ul className="space-y-2">{lecture.learning_objectives.map((objective, index) => <li key={`${objective}-${index}`} className="flex gap-2 text-sm leading-6 text-muted-foreground"><Check className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />{objective}</li>)}</ul></div>
        {lecture.common_failure_mode && <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm leading-6"><div className="font-semibold text-amber-800 dark:text-amber-300">Common failure mode</div><div className="mt-1 text-muted-foreground">{lecture.common_failure_mode}</div></div>}
        <div className={`space-y-2 ${busy ? 'opacity-60' : ''}`}>{lecture.sections.map((section, index) => { const open = openSections.includes(index); return <div key={`${section.title}-${index}`} className="overflow-hidden rounded-2xl border border-border/70 bg-card"><button onClick={() => toggleSection(index)} aria-expanded={open} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-sm font-semibold transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span>{index + 1}. {stripNumber(section.title)}</span>{open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}</button>{open && <div className="space-y-4 border-t border-border/70 px-4 py-4"><div className="text-muted-foreground">{renderMarkdown(section.content)}</div>{section.example && <div><div className="mb-1 flex items-center gap-2 text-xs font-semibold"><BookOpen className="h-3.5 w-3.5 text-primary" />Example</div><div className="rounded-xl bg-muted/70 p-3 text-sm leading-6">{renderMarkdown(section.example)}</div></div>}{section.debugging_method && <div><div className="mb-1 flex items-center gap-2 text-xs font-semibold"><TerminalSquare className="h-3.5 w-3.5 text-primary" />Debugging method</div><p className="text-sm leading-6 text-muted-foreground">{section.debugging_method}</p></div>}</div>}</div> })}</div>
        {lecture.recap.length > 0 && <div><div className="mb-2 text-sm font-semibold">Concise recap</div><ul className="space-y-2">{lecture.recap.map((line, index) => <li key={`${line}-${index}`} className="flex gap-2 text-sm leading-6 text-muted-foreground"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />{line}</li>)}</ul></div>}
        <div className="flex flex-wrap items-center gap-2">{ACTIONS.map((item) => <Button key={item.action} onClick={() => props.onAction(item.action)} disabled={busy} variant="outline" className="min-h-10 rounded-xl">{item.label}</Button>)}{busy && <span className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />Working… variants are cached after the first time.</span>}</div>
        <div className="rounded-2xl border border-border/70 bg-card p-4"><div className="flex items-center gap-2 text-sm font-semibold"><MessageSquareText className="h-4 w-4 text-primary" />Retrieval check</div>{lecture.retrieval_check.prompt ? <><p className="mt-2 text-sm leading-6">{lecture.retrieval_check.prompt}</p><p className="mt-2 text-xs text-muted-foreground">Answer rule: {lecture.retrieval_check.answer_rule || 'Explain your reasoning in your own words.'}</p><Textarea value={retrievalAnswer} onChange={(event) => setRetrievalAnswer(event.target.value)} className="mt-3 min-h-24 rounded-xl" placeholder="Write a short explanation…" /><Button onClick={() => { props.onRetrievalSubmit(retrievalAnswer); setRetrievalAnswer('') }} disabled={!retrievalAnswer.trim() || busy} className="mt-3 min-h-10 rounded-xl">Submit retrieval check</Button>{retrievalFeedback && <div className="mt-3 rounded-xl bg-muted/70 p-3 text-sm leading-6" role="status"><div className="mb-1 text-xs font-semibold">Feedback</div>{retrievalFeedback}</div>}</> : <p className="mt-2 text-sm text-muted-foreground">No retrieval prompt was returned for this lesson.</p>}</div>
        <div className="rounded-2xl border border-border/70 bg-card p-4"><div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" />Transfer exercise</div><p className="mt-2 text-sm leading-6 text-muted-foreground">{lecture.transfer_exercise.prompt || 'The coach did not attach a transfer exercise.'}</p>{lecture.transfer_exercise.format && <Badge variant="outline" className="mt-3 rounded-full">{lecture.transfer_exercise.format}</Badge>}</div>
      </CardContent></Card>

      <Card className="rounded-3xl border-border/70 shadow-sm"><CardContent className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          {practiceButton}
          <Button onClick={props.onMarkLearned} disabled={marking || learnState !== 'none'} variant={learnState === 'none' ? 'secondary' : 'outline'} className="min-h-11 gap-2 rounded-xl">{marking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{learnState === 'none' ? 'Mark learned' : learnState === 'learned' ? 'Learned' : 'Learned and assessed'}</Button>
          {nextTopic ? <Button onClick={props.onNextTopic} variant="outline" className="min-h-11 gap-2 rounded-xl">Next topic: {nextTopic.label}<ArrowRight className="h-4 w-4" /></Button> : <span className="text-sm text-muted-foreground">This is the last topic in {domainLabel}.</span>}
        </div>
        {practiceStatus === 'error' && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">The practice exercise could not be prepared.<Button onClick={props.onRetryPractice} variant="outline" size="sm" className="rounded-xl">Retry</Button></div>}
        {learnState === 'learned' && <p className="text-xs text-muted-foreground">Marked as learned. Your skill rating stays empty until you take the topic assessment.</p>}
      </CardContent></Card>
    </>}

    <AlertDialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Regenerate this lesson?</AlertDialogTitle><AlertDialogDescription>Claude will write a new lesson for {topicLabel}. The saved lesson, its shorter/longer variants and the practice exercise are replaced, for every learner. This can take 30–60s.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { setOpenSections([0]); props.onRegenerate() }}>Regenerate</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
