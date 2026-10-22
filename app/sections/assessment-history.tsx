'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, CircleAlert, ClipboardList, Eye, Loader2, Play, RefreshCw, RotateCcw, X } from 'lucide-react'
import type { useAuth } from 'lyzr-architect-pg/client'
import { InlineText, PromptText, CODE_BLOCK_CLASS } from '@/components/RichText'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { HistorySession, HistoryTopic, MasteryChange, Outcome } from '@/lib/assessment-history'
import { DOMAINS } from '@/lib/taxonomy'

type AuthFetch = ReturnType<typeof useAuth>['authFetch']

export type ReviewQuestion = {
  item_id: string; slot: number; type: string; stem: string; artifact: string | null; options: string[]
  domain_id: string; topic_id: string; topic_name: string; subtopic: string; difficulty: number | null
} & ({ answered: false } | {
  answered: true; selected_answers: string[]; correct_answers: string[]; outcome: Outcome; partial_credit: number; explanation: string; misconception: string | null
  difficulty_rationale: string[]; confidence: number | null; justification: string | null; answered_at: string; response_time_ms: number | null
  mastery_delta: { before?: number; after?: number; delta?: number; band_before?: string; band_after?: string } | null
})
export type ReviewSession = Omit<HistorySession, 'mastery_changes' | 'completed_at'> & { questions: ReviewQuestion[] }

export type HistoryActions = {
  onRetake: (session: Pick<HistorySession, 'topics' | 'mode' | 'question_count'>) => void // fresh set on the same topics
  onRetry: (sessionId: string) => void // the same questions again (no mastery effect)
  onResume: (sessionId: string) => void
  busy?: boolean // a set is being written: the start buttons wait
}

const SELECTION_LABEL: Record<string, string> = { topic: 'Single topic', custom: 'Custom', diagnostic: 'Mixed diagnostic', retake: 'Retry' }
const STATUS_LABEL: Record<string, string> = { in_progress: 'In progress', completed: 'Completed', abandoned: 'Abandoned' }
const OUTCOME_STYLE: Record<Outcome, string> = { correct: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400', partial: 'bg-amber-500/10 text-amber-700 dark:text-amber-400', incorrect: 'bg-destructive/10 text-destructive' }
const OUTCOME_LABEL: Record<Outcome, string> = { correct: 'Correct', partial: 'Partly correct', incorrect: 'Incorrect' }

const dayKey = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })
const timeText = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
const signed = (value: number) => (value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '±0')

function MasteryChip({ change, showName }: { change: MasteryChange; showName: boolean }) {
  const bandMoved = change.from_band && change.to_band && change.from_band !== change.to_band
  const tone = change.delta > 0 ? 'text-emerald-700 dark:text-emerald-400' : change.delta < 0 ? 'text-destructive' : 'text-muted-foreground'
  return <span className={`inline-flex items-center gap-1 rounded-full border border-border/70 px-2.5 py-1 text-[11px] ${tone}`}>
    {showName && <span className="font-medium text-foreground">{change.name}</span>}
    {bandMoved ? <span>{change.from_band}<ArrowRight className="mx-0.5 inline h-3 w-3" />{change.to_band}</span> : change.to_band ? <span>{change.to_band}</span> : null}
    <span className="tabular-nums">{signed(Math.round(change.delta))}</span>
  </span>
}

function ScoreChip({ session }: { session: Pick<HistorySession, 'answered_count' | 'correct_count' | 'question_count' | 'score_pct' | 'status'> }) {
  if (session.answered_count === 0) return <Badge variant="outline" className="rounded-full">No answers</Badge>
  const partial = session.answered_count < session.question_count
  return <Badge variant="secondary" className="rounded-full tabular-nums" title={`${session.score_pct ?? 0}%`}>{session.correct_count}/{session.answered_count}{partial ? ` of ${session.question_count}` : ''} correct{session.score_pct !== null ? ` · ${session.score_pct}%` : ''}</Badge>
}

function StatusBadge({ status }: { status: HistorySession['status'] }) {
  return <Badge variant={status === 'completed' ? 'default' : 'outline'} className="rounded-full">{STATUS_LABEL[status]}</Badge>
}

function topicOptions(sessions: HistorySession[], domainId: string): HistoryTopic[] {
  const seen = new Map<string, HistoryTopic>()
  for (const session of sessions) for (const topic of session.topics) if (!domainId || topic.domain_id === domainId) seen.set(`${topic.domain_id}/${topic.topic_id}`, topic)
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function AssessmentHistoryList({ authFetch, actions, onReview, refreshKey }: { authFetch: AuthFetch; actions: HistoryActions; onReview: (sessionId: string) => void; refreshKey?: number }) {
  const [sessions, setSessions] = useState<HistorySession[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [domain, setDomain] = useState('')
  const [topic, setTopic] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')

  const load = useCallback(async (after: string | null) => {
    setLoading(true); setError(null)
    try {
      const response = await authFetch(`/api/assessment/history?limit=20${after ? `&cursor=${encodeURIComponent(after)}` : ''}`)
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.success !== true || !Array.isArray(body.data)) throw new Error(typeof body?.error === 'string' ? body.error : 'Assessment history could not be loaded.')
      setSessions((current) => after ? [...current, ...(body.data as HistorySession[]).filter((row) => !current.some((existing) => existing.session_id === row.session_id))] : body.data)
      setCursor(typeof body.next_cursor === 'string' ? body.next_cursor : null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Assessment history could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [authFetch])
  useEffect(() => { void load(null) }, [load, refreshKey])

  const topics = useMemo(() => topicOptions(sessions, domain), [sessions, domain])
  const visible = useMemo(() => sessions.filter((session) =>
    (!domain || session.topics.some((entry) => entry.domain_id === domain)) &&
    (!topic || session.topics.some((entry) => `${entry.domain_id}/${entry.topic_id}` === topic)) &&
    (!kind || session.selection === kind) && (!status || session.status === status)), [sessions, domain, topic, kind, status])
  const groups = useMemo(() => {
    const out: { day: string; rows: HistorySession[] }[] = []
    for (const session of visible) { const day = dayKey(session.started_at); const last = out[out.length - 1]; if (last?.day === day) last.rows.push(session); else out.push({ day, rows: [session] }) }
    return out
  }, [visible])

  const select = 'min-h-10 rounded-lg border border-input bg-background px-3 text-xs'
  return <Card className="rounded-3xl border-border/70 shadow-sm">
    <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" />Assessments</CardTitle><p className="text-sm text-muted-foreground">Every assessment you started: single topics, custom sets and the mixed diagnostic. Open one to review your answers.</p></CardHeader>
    <CardContent className="space-y-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter assessments">
        <select aria-label="Domain" value={domain} onChange={(event) => { setDomain(event.target.value); setTopic('') }} className={select}><option value="">All domains</option>{DOMAINS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select>
        <select aria-label="Topic" value={topic} onChange={(event) => setTopic(event.target.value)} className={select}><option value="">All topics</option>{topics.map((entry) => <option key={`${entry.domain_id}/${entry.topic_id}`} value={`${entry.domain_id}/${entry.topic_id}`}>{entry.name}</option>)}</select>
        <select aria-label="Type" value={kind} onChange={(event) => setKind(event.target.value)} className={select}><option value="">All types</option>{Object.entries(SELECTION_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)} className={select}><option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      </div>
      {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><span>{error}</span><Button size="sm" variant="outline" className="rounded-xl" onClick={() => void load(null)}>Retry</Button></div>}
      {groups.map((group) => <section key={group.day} aria-label={group.day}>
        <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{group.day}</h3>
        <ul className="mt-2 divide-y divide-border/70">{group.rows.map((session) => {
          const multi = session.mastery_changes.length > 1
          return <li key={session.session_id} className="py-4" data-testid="assessment-row">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <button type="button" disabled={session.answered_count === 0} onClick={() => onReview(session.session_id)} className="min-w-0 flex-1 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{session.title}</span><StatusBadge status={session.status} /><ScoreChip session={session} /></div>
                <div className="mt-1 text-xs text-muted-foreground">{timeText(session.started_at)} · {SELECTION_LABEL[session.selection]} · {session.question_count} question{session.question_count === 1 ? '' : 's'}</div>
                {session.mastery_changes.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{session.mastery_changes.map((change) => <MasteryChip key={`${change.domain_id}/${change.topic_id}`} change={change} showName={multi || session.selection !== 'topic'} />)}</div>}
                {session.selection === 'retake' && <div className="mt-2 text-[11px] text-muted-foreground">Practice retry of earlier questions: no mastery change.</div>}
              </button>
              <div className="flex flex-wrap gap-2">
                {session.status === 'in_progress' && <Button size="sm" disabled={actions.busy} className="min-h-9 gap-1.5 rounded-xl" onClick={() => actions.onResume(session.session_id)}><Play className="h-3.5 w-3.5" />Resume</Button>}
                {session.answered_count > 0 && <Button size="sm" variant="outline" className="min-h-9 gap-1.5 rounded-xl" onClick={() => onReview(session.session_id)}><Eye className="h-3.5 w-3.5" />Review</Button>}
                <Button size="sm" variant="outline" disabled={actions.busy} className="min-h-9 gap-1.5 rounded-xl" onClick={() => actions.onRetake(session)}><RefreshCw className="h-3.5 w-3.5" />{session.topics.length === 1 ? 'Retake this topic' : 'Retake these topics'}</Button>
              </div>
            </div>
          </li>
        })}</ul>
      </section>)}
      {!loading && !error && visible.length === 0 && <div className="rounded-2xl bg-muted/60 p-6 text-sm text-muted-foreground">{sessions.length === 0 ? 'No assessments yet. Start one from Home or the Skill Map and it will show up here.' : 'No assessments match these filters.'}</div>}
      {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading assessments…</div>}
      {cursor && !loading && <Button variant="outline" className="min-h-10 rounded-xl" onClick={() => void load(cursor)}>Load older assessments</Button>}
    </CardContent>
  </Card>
}

function QuestionCard({ question, index }: { question: ReviewQuestion; index: number }) {
  const answered = question.answered
  const selected = answered ? question.selected_answers : []
  const correct = answered ? question.correct_answers : []
  return <Card className="rounded-3xl border-border/70 shadow-sm" data-testid="review-question">
    <CardContent className="space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Question {index + 1}</span>
        <Badge variant="secondary" className="rounded-full">{question.topic_name}</Badge>
        {question.difficulty && <Badge variant="outline" className="rounded-full">Difficulty {question.difficulty}/5</Badge>}
        {question.type === 'multiple_answer' && <Badge variant="outline" className="rounded-full">Select all that apply</Badge>}
        {question.answered ? <span className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${OUTCOME_STYLE[question.outcome]}`}>{OUTCOME_LABEL[question.outcome]}</span> : <Badge variant="outline" className="ml-auto rounded-full">Not answered</Badge>}
      </div>
      <h3 className="text-base font-semibold leading-7"><InlineText text={question.stem} /></h3>
      {question.artifact && <pre translate="no" className={CODE_BLOCK_CLASS}>{question.artifact}</pre>}
      <ul className="space-y-2">{question.options.map((option) => {
        const picked = selected.includes(option)
        const right = correct.includes(option)
        const tone = !answered ? 'border-border/70' : right ? 'border-emerald-500/50 bg-emerald-500/[0.07]' : picked ? 'border-destructive/40 bg-destructive/[0.05]' : 'border-border/70'
        return <li key={option} className={`flex items-start gap-3 rounded-2xl border p-3 text-sm leading-6 ${tone}`}>
          <span className="mt-0.5 shrink-0">{answered ? right ? <Check className="h-4 w-4 text-emerald-600" aria-label="Correct answer" /> : picked ? <X className="h-4 w-4 text-destructive" aria-label="Your wrong answer" /> : <span className="block h-4 w-4" /> : <span className="block h-4 w-4" />}</span>
          <span className="min-w-0 flex-1"><InlineText text={option} /></span>
          <span className="flex shrink-0 flex-wrap gap-1">{picked && <Badge variant="outline" className="rounded-full text-[10px]">Your answer</Badge>}{right && <Badge className="rounded-full bg-emerald-600 text-[10px] text-white">Correct</Badge>}</span>
        </li>
      })}</ul>
      {question.answered ? <div className="space-y-3 rounded-2xl bg-muted/60 p-4 text-sm">
        {question.explanation && <div><div className="mb-1 font-semibold">Explanation</div><div className="text-muted-foreground"><PromptText text={question.explanation} /></div></div>}
        {question.misconception && question.outcome !== 'correct' && <div><div className="mb-1 font-semibold text-amber-800 dark:text-amber-300">Common misconception</div><div className="text-muted-foreground"><PromptText text={question.misconception} /></div></div>}
        {question.difficulty_rationale.length > 0 && <div><div className="mb-1 font-semibold">Why this difficulty</div><ul className="list-disc space-y-0.5 pl-4 text-xs leading-5 text-muted-foreground">{question.difficulty_rationale.map((line, i) => <li key={`${line}-${i}`}><InlineText text={line} /></li>)}</ul></div>}
        {question.justification && <div><div className="mb-1 font-semibold">Your reasoning</div><p className="text-muted-foreground"><InlineText text={question.justification} /></p></div>}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>Answered {new Date(question.answered_at).toLocaleString()}</span>{question.confidence !== null && <span>Confidence {Math.round(question.confidence * 100)}%</span>}{question.response_time_ms ? <span>{Math.round(question.response_time_ms / 1000)}s</span> : null}{question.mastery_delta && typeof question.mastery_delta.delta === 'number' && <span>Mastery {signed(Math.round(question.mastery_delta.delta))}</span>}</div>
      </div> : <div className="flex items-center gap-2 rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground"><CircleAlert className="h-4 w-4" />The answer and explanation appear after you answer this question.</div>}
    </CardContent>
  </Card>
}

export function AssessmentReview({ authFetch, sessionId, actions, onBack, backLabel }: { authFetch: AuthFetch; sessionId: string; actions: HistoryActions; onBack: () => void; backLabel: string }) {
  const [session, setSession] = useState<ReviewSession | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setSession(null); setError(null)
    authFetch(`/api/assessment/session?id=${encodeURIComponent(sessionId)}`).then(async (response) => {
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.success !== true) throw new Error(response.status === 404 ? 'This assessment could not be found.' : typeof body?.error === 'string' ? body.error : 'The assessment could not be loaded.')
      if (!cancelled) setSession(body.data as ReviewSession)
    }).catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : 'The assessment could not be loaded.') })
    return () => { cancelled = true }
  }, [authFetch, sessionId])

  const back = <button onClick={onBack} className="mb-3 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowRight className="h-4 w-4 rotate-180" />{backLabel}</button>
  if (error) return <div className="mx-auto w-full max-w-4xl space-y-4 pb-10">{back}<div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div></div>
  if (!session) return <div className="mx-auto w-full max-w-4xl pb-10">{back}<div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading your answers…</div></div>
  const retakeInput = { topics: session.topics, mode: session.mode, question_count: session.question_count }
  const answeredAny = session.answered_count > 0
  return <div className="mx-auto w-full max-w-4xl space-y-6 pb-10">
    <div className="border-b border-border/70 pb-6">
      {back}
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Assessment review</div>
      <h1 className="mt-3 font-serif text-3xl tracking-tight text-balance">{session.title}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"><span>{new Date(session.started_at).toLocaleString()}</span><StatusBadge status={session.status} /><ScoreChip session={session} /><Badge variant="outline" className="rounded-full">{SELECTION_LABEL[session.selection]}</Badge></div>
      {session.selection === 'retake' && <p className="mt-3 text-xs leading-5 text-muted-foreground">This was a practice retry of earlier questions; it does not change your mastery.</p>}
      <div className="mt-5 flex flex-wrap gap-2">
        {session.status === 'in_progress' && <Button disabled={actions.busy} className="min-h-10 gap-2 rounded-xl" onClick={() => actions.onResume(session.session_id)}><Play className="h-4 w-4" />Resume</Button>}
        <Button variant="outline" disabled={actions.busy} className="min-h-10 gap-2 rounded-xl" onClick={() => actions.onRetake(retakeInput)}><RefreshCw className="h-4 w-4" />{session.topics.length === 1 ? 'Retake this topic (new questions)' : 'Retake these topics (new questions)'}</Button>
        {answeredAny && <Button variant="outline" disabled={actions.busy} className="min-h-10 gap-2 rounded-xl" onClick={() => actions.onRetry(session.session_id)} title="The same questions again, in a new order. Practice only: your mastery does not change."><RotateCcw className="h-4 w-4" />Retry the same questions</Button>}
      </div>
    </div>
    {session.questions.length === 0 ? <div className="rounded-2xl bg-muted/60 p-6 text-sm text-muted-foreground">No questions were saved for this assessment.</div> : session.questions.map((question, index) => <QuestionCard key={question.item_id} question={question} index={index} />)}
  </div>
}
