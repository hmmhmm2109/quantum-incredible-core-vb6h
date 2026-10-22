'use client'

import * as React from 'react'
import { ArrowRight, FlaskConical, Loader2, LockKeyhole, RefreshCw, Target, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAiProvider } from '@/hooks/use-ai-provider'
import { DEFAULT_QUESTIONS, effectiveQuestionCount, MAX_PER_TOPIC, MAX_QUESTIONS, MAX_TOPICS, perTopicCount, topicKey, type AssessmentMode, type TopicRef } from '@/lib/assessment-plan'
import { DOMAINS } from '@/lib/taxonomy'
import type { SkillDomain } from '@/app/sections/skill-map-section'
import TopicMultiSelect, { assessed, skillInfo } from '@/app/sections/topic-multiselect'

export type CustomAssessmentRequest = { topics: TopicRef[]; count: number; mode: AssessmentMode; fresh: boolean }
type Unfinished = { answered: number; total: number }
type Props = {
  skillDomains: SkillDomain[]
  sampleData: boolean
  busy: boolean
  findUnfinished: (topics: TopicRef[], mode: AssessmentMode) => Unfinished | null
  onStart: (request: CustomAssessmentRequest) => void
  onBack: () => void
}

const STORAGE_KEY = 'embedpath.assessment-picker.v1'
const COUNTS = [3, 4, 5, 6, 8, 10]
type Stored = { selected: string[]; count: number | 'per'; mode: AssessmentMode }
const validKeys = new Set(DOMAINS.flatMap((domain) => domain.topics.map((topic) => `${domain.id}/${topic.id}`)))

function loadStored(): Stored | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Stored> | null
    if (!raw || !Array.isArray(raw.selected)) return null
    const selected = raw.selected.filter((key): key is string => typeof key === 'string' && validKeys.has(key))
    const count = raw.count === 'per' ? 'per' : COUNTS.includes(Number(raw.count)) ? Number(raw.count) : DEFAULT_QUESTIONS
    return { selected, count, mode: raw.mode === 'domain_assessment' ? 'domain_assessment' : 'knowledge_check' }
  } catch { return null }
}

const parseKey = (key: string): TopicRef => { const [domain_id, topic_id] = key.split('/'); return { domain_id, topic_id } }

export default function AssessmentPicker({ skillDomains, sampleData, busy, findUnfinished, onStart, onBack }: Props) {
  const ai = useAiProvider()
  const [mode, setMode] = React.useState<AssessmentMode>('knowledge_check')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [count, setCount] = React.useState<number | 'per'>(DEFAULT_QUESTIONS)
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState<Set<string>>(new Set([DOMAINS[0].id]))
  const [restored, setRestored] = React.useState(false)

  const info = React.useMemo(() => skillInfo(skillDomains, sampleData), [skillDomains, sampleData])

  // Restore the last selection once (browser storage is only a convenience: any failure just starts empty).
  React.useEffect(() => {
    const stored = loadStored()
    if (stored) {
      setMode(stored.mode); setCount(stored.count); setSelected(new Set(stored.selected))
      const domains = new Set(stored.selected.map((key) => key.split('/')[0]))
      if (domains.size > 0) setOpen(domains)
    }
    setRestored(true)
  }, [])
  React.useEffect(() => {
    if (!restored) return
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ selected: [...selected], count, mode } satisfies Stored)) } catch { /* storage unavailable */ }
  }, [selected, count, mode, restored])

  const topics = React.useMemo(() => [...selected].map(parseKey), [selected])
  const questionCount = count === 'per' ? perTopicCount(topics.length) : effectiveQuestionCount(count, topics.length)
  const needsRoom = topics.length > 0 && topics.length > questionCount
  const tooMany = topics.length > MAX_TOPICS
  const domainOfSelection = new Set(topics.map((topic) => topic.domain_id))
  const valid = topics.length > 0 && !tooMany && (mode === 'knowledge_check' || domainOfSelection.size === 1)
  const unfinished = valid ? findUnfinished(topics, mode) : null

  // In domain mode a selection never spans domains: touching another domain starts a new one.
  const apply = (next: Set<string>, touchedDomain?: string) => {
    if (mode === 'domain_assessment' && touchedDomain) for (const key of [...next]) if (!key.startsWith(`${touchedDomain}/`)) next.delete(key)
    setSelected(next)
  }
  const toggleTopic = (key: string) => { const next = new Set(selected); if (next.has(key)) next.delete(key); else next.add(key); apply(next, key.split('/')[0]) }
  const toggleDomain = (domainId: string, keys: string[]) => {
    const next = new Set(selected)
    const all = keys.every((key) => next.has(key))
    for (const key of keys) { if (all) next.delete(key); else next.add(key) }
    apply(next, domainId)
  }
  const chooseMode = (value: AssessmentMode) => {
    setMode(value)
    if (value === 'domain_assessment') {
      // Keep only the domain that has the most selected topics (first one on a tie).
      const tally = new Map<string, number>()
      for (const key of selected) { const domain = key.split('/')[0]; tally.set(domain, (tally.get(domain) ?? 0) + 1) }
      const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      if (best) setSelected(new Set([...selected].filter((key) => key.startsWith(`${best}/`))))
    }
  }

  const allTopics = DOMAINS.flatMap((domain) => domain.topics.map((topic) => ({ key: `${domain.id}/${topic.id}`, domainId: domain.id, score: info.get(`${domain.id}/${topic.id}`) })))
  const preset = (kind: 'weakest' | 'unassessed') => {
    if (mode === 'domain_assessment') chooseMode('knowledge_check')
    const pool = kind === 'weakest'
      ? allTopics.filter((entry) => assessed(entry.score)).sort((a, b) => (a.score?.score ?? 0) - (b.score?.score ?? 0)).slice(0, 5)
      : allTopics.filter((entry) => !assessed(entry.score)).slice(0, 6)
    setSelected(new Set(pool.map((entry) => entry.key)))
    setMode('knowledge_check')
    setOpen(new Set(pool.map((entry) => entry.domainId)))
  }
  const assessedCount = allTopics.filter((entry) => assessed(entry.score)).length
  const unassessedCount = allTopics.length - assessedCount

  const modeCards: { id: AssessmentMode | 'expert'; title: string; text: string; icon: React.ElementType }[] = [
    { id: 'knowledge_check', title: 'Knowledge check', text: 'Pick any topics. Questions are spread across them, weakest first.', icon: Target },
    { id: 'domain_assessment', title: 'Domain assessment', text: 'One domain, broader evidence across its topics.', icon: FlaskConical },
    { id: 'expert', title: 'Expert challenge', text: 'Cross-domain scenarios. Not available yet.', icon: LockKeyhole },
  ]
  const start = (fresh: boolean) => { if (valid && !busy) onStart({ topics, count: questionCount, mode, fresh }) }

  return (
    <div className="mx-auto w-full max-w-7xl pb-10">
      <div className="border-b border-border/70 pb-7">
        <button onClick={onBack} className="mb-3 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowRight className="h-4 w-4 rotate-180" /><span>Back to home</span></button>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary"><span className="h-px w-6 bg-primary" /><span>Assessment setup</span></div>
        <h1 className="mt-3 font-serif text-4xl tracking-tight text-balance sm:text-5xl">Choose what to be checked on.</h1>
        <p className="mt-3 max-w-2xl text-pretty leading-7 text-muted-foreground">Select the topics, pick how many questions, and start. You can load a fresh set of questions for the same topics whenever you like.</p>
      </div>

      <div role="radiogroup" aria-label="Assessment mode" className="mt-6 grid gap-3 md:grid-cols-3">
        {modeCards.map((card) => {
          const Icon = card.icon
          const disabled = card.id === 'expert'
          const active = !disabled && mode === card.id
          return (
            <button key={card.id} type="button" role="radio" aria-checked={active} aria-disabled={disabled} onClick={() => { if (!disabled) chooseMode(card.id as AssessmentMode) }}
              className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'border-primary bg-primary/[0.045]' : 'border-border/70 bg-card'} ${disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-primary/50'}`}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-primary shadow-sm"><Icon className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="flex items-center gap-2 text-sm font-semibold"><span>{card.title}</span>{disabled && <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px]"><span>Coming soon</span></Badge>}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{card.text}</span></span>
            </button>
          )
        })}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <TopicMultiSelect skillDomains={skillDomains} sampleData={sampleData} selected={selected} onToggleTopic={toggleTopic} onToggleDomain={toggleDomain} open={open} onOpenChange={setOpen} query={query} onQueryChange={setQuery} idPrefix="picker"
          toolbar={<>
            <Button type="button" variant="outline" size="sm" disabled={assessedCount === 0} onClick={() => preset('weakest')} className="min-h-10 rounded-xl"><span>Weakest topics</span></Button>
            <Button type="button" variant="outline" size="sm" disabled={unassessedCount === 0} onClick={() => preset('unassessed')} className="min-h-10 rounded-xl"><span>Not yet assessed</span></Button>
            <Button type="button" variant="ghost" size="sm" disabled={selected.size === 0} onClick={() => setSelected(new Set())} className="min-h-10 gap-1 rounded-xl"><X className="h-3.5 w-3.5" /><span>Clear</span></Button>
          </>} />

        <Card className="h-fit rounded-3xl border-border/70 shadow-sm xl:sticky xl:top-6">
          <CardHeader>
            <div className="flex items-center justify-between gap-3"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"><span>Your assessment</span></div><Badge variant="secondary" className="rounded-full" aria-live="polite"><span>{topics.length} {topics.length === 1 ? 'topic' : 'topics'} selected</span></Badge></div>
            <CardTitle className="mt-2 text-xl"><span>{topics.length === 0 ? 'Select at least one topic.' : `${questionCount} ${questionCount === 1 ? 'question' : 'questions'}`}</span></CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div id="picker-count-label" className="mb-2 text-sm font-semibold">Number of questions</div>
              <div role="group" aria-labelledby="picker-count-label" className="flex flex-wrap gap-2">
                {COUNTS.map((value) => <Button key={value} type="button" size="sm" variant={count === value ? 'default' : 'outline'} aria-pressed={count === value} onClick={() => setCount(value)} className="min-h-10 min-w-10 rounded-xl tabular-nums">{value}</Button>)}
                <Button type="button" size="sm" variant={count === 'per' ? 'default' : 'outline'} aria-pressed={count === 'per'} disabled={topics.length > MAX_QUESTIONS} onClick={() => setCount('per')} className="min-h-10 rounded-xl"><span>One per topic</span></Button>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{needsRoom ? `More topics than questions: the ${questionCount} weakest are asked.` : `Up to ${MAX_PER_TOPIC} per topic, ${MAX_QUESTIONS} in total. Every answer moves a topic by at most 8 points.`}</p>
            </div>
            {mode === 'domain_assessment' && domainOfSelection.size > 1 && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5 text-destructive">A domain assessment covers one domain.</p>}
            {tooMany && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5 text-destructive">Select at most {MAX_TOPICS} topics.</p>}
            <p className="rounded-xl bg-muted/60 p-3 text-xs leading-5 text-muted-foreground"><span>{ai.short} writes the first question in about 30 to 60 seconds. The others are written one ahead while you answer.</span></p>
            {unfinished ? (
              <div className="space-y-2">
                <p className="rounded-xl border border-primary/20 bg-primary/[0.045] p-3 text-xs leading-5"><span className="font-semibold">Unfinished set for these topics.</span> <span className="text-muted-foreground">{unfinished.answered} of {unfinished.total} answered.</span></p>
                <Button type="button" onClick={() => start(false)} disabled={busy} className="min-h-11 w-full gap-2 rounded-xl active:scale-[0.98] transition-transform">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}<span>Resume where I left off</span></Button>
                <Button type="button" onClick={() => start(true)} disabled={busy} variant="outline" className="min-h-11 w-full gap-2 rounded-xl active:scale-[0.98] transition-transform"><RefreshCw className="h-4 w-4" /><span>Load new questions instead</span></Button>
              </div>
            ) : (
              <Button type="button" onClick={() => start(false)} disabled={!valid || busy} className="min-h-11 w-full gap-2 rounded-xl active:scale-[0.98] transition-transform">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}<span>{valid ? `Start assessment (${topics.length} ${topics.length === 1 ? 'topic' : 'topics'}, ${questionCount} questions)` : 'Select topics to start'}</span></Button>
            )}
            {sampleData && <p className="text-xs leading-5 text-muted-foreground">Example data is on, so no mastery levels are shown. Your answers still count once you are signed in.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
