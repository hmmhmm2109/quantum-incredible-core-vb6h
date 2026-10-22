'use client'

import * as React from 'react'
import { ArrowRight, Code2, Layers, ListOrdered, Loader2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAiProvider } from '@/hooks/use-ai-provider'
import { MAX_MULTI_TOPICS, refKey, refOfKey, topicsFromStored, type PracticeMode, type TopicRef } from '@/lib/practice-multi'
import { DOMAINS, findDomain, findTopic } from '@/lib/taxonomy'
import type { SkillDomain } from '@/app/sections/skill-map-section'
import TopicMultiSelect, { assessed, skillInfo } from '@/app/sections/topic-multiselect'

export type PracticeSelectionRequest = { topics: TopicRef[]; mode: PracticeMode }
type Props = {
  skillDomains: SkillDomain[]
  sampleData: boolean
  busy: boolean
  practised: Set<string> // "<domain>/<topic>" keys with at least one saved code attempt
  initial?: TopicRef[] // e.g. the topic chosen in the Home card
  onStart: (request: PracticeSelectionRequest) => void
  onBack: () => void
}

const STORAGE_KEY = 'embedpath.practice-picker.v1'
type Stored = { selected: string[]; mode: PracticeMode }

function loadStored(): Stored | null {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Stored> | null
    if (!raw || !Array.isArray(raw.selected)) return null
    const selected = topicsFromStored(raw.selected.map((key) => typeof key === 'string' ? refOfKey(key) : null)).map(refKey).slice(0, MAX_MULTI_TOPICS)
    return { selected, mode: raw.mode === 'per-topic' ? 'per-topic' : 'integrated' }
  } catch { return null }
}

export default function PracticeTopicPicker({ skillDomains, sampleData, busy, practised, initial, onStart, onBack }: Props) {
  const ai = useAiProvider()
  const [mode, setMode] = React.useState<PracticeMode>('integrated')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [query, setQuery] = React.useState('')
  const [open, setOpen] = React.useState<Set<string>>(new Set([DOMAINS[0].id]))
  const [restored, setRestored] = React.useState(false)
  const info = React.useMemo(() => skillInfo(skillDomains, sampleData), [skillDomains, sampleData])

  // The last selection is restored; without one the topic chosen on Home seeds it. Browser storage is only a convenience (any failure just starts empty).
  React.useEffect(() => {
    const stored = loadStored()
    const seed = stored && stored.selected.length > 0 ? stored.selected : (initial ?? []).map(refKey)
    if (stored) setMode(stored.mode)
    setSelected(new Set(seed))
    const domains = new Set(seed.map((key) => key.split('/')[0]))
    if (domains.size > 0) setOpen(domains)
    setRestored(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!restored) return
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ selected: [...selected], mode } satisfies Stored)) } catch { /* storage unavailable */ }
  }, [selected, mode, restored])

  const keys = [...selected]
  const topics = keys.map(refOfKey)
  const full = topics.length >= MAX_MULTI_TOPICS
  const domainsInSelection = new Set(topics.map((topic) => topic.domain_id))
  const valid = topics.length >= 1 && topics.length <= MAX_MULTI_TOPICS
  const all = DOMAINS.flatMap((domain) => domain.topics.map((topic) => ({ key: `${domain.id}/${topic.id}`, domainId: domain.id, skill: info.get(`${domain.id}/${topic.id}`) })))
  const assessedCount = all.filter((entry) => assessed(entry.skill)).length
  const fresh = all.filter((entry) => !practised.has(entry.key))

  const toggleTopic = (key: string) => setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else if (next.size < MAX_MULTI_TOPICS) next.add(key); return next })
  const toggleDomain = (_domainId: string, domainKeys: string[]) => setSelected((current) => {
    const next = new Set(current)
    if (domainKeys.every((key) => next.has(key))) for (const key of domainKeys) next.delete(key)
    else for (const key of domainKeys) { if (next.size >= MAX_MULTI_TOPICS) break; next.add(key) }
    return next
  })
  const pick = (entries: { key: string; domainId: string }[]) => { const chosen = entries.slice(0, MAX_MULTI_TOPICS); setSelected(new Set(chosen.map((entry) => entry.key))); setOpen(new Set(chosen.map((entry) => entry.domainId))) }
  const presetWeakest = () => pick(all.filter((entry) => assessed(entry.skill)).sort((a, b) => (a.skill?.score ?? 0) - (b.skill?.score ?? 0)))
  // Topics of one domain that have no code attempt yet, starting with the first such topic in taxonomy order.
  const presetFresh = () => { const lead = fresh[0]; if (lead) pick(fresh.filter((entry) => entry.domainId === lead.domainId)) }

  const label = (key: string) => { const ref = refOfKey(key); return findTopic(ref.domain_id, ref.topic_id)?.label ?? key }
  const modeCards: { id: PracticeMode; title: string; text: string; icon: React.ElementType }[] = [
    { id: 'integrated', title: 'One integrated exercise', text: 'A single realistic task that needs every selected topic together. Written once, then reused.', icon: Layers },
    { id: 'per-topic', title: 'One exercise per topic', text: 'A short series: the usual exercise of each topic, one after the other.', icon: ListOrdered },
  ]
  const startLabel = !valid ? 'Select topics to start' : topics.length === 1 ? 'Start a code exercise (1 topic)' : mode === 'integrated' ? `Start integrated exercise (${topics.length} topics)` : `Start exercise series (${topics.length} topics)`
  const waitText = mode === 'integrated' && topics.length > 1
    ? `${ai.short} writes a new integrated exercise in about 30 to 60 seconds. After that it is reused whenever you pick the same topics.`
    : `Each topic uses its usual exercise (written once, then reused). ${ai.short} only writes a topic's exercise the first time, about 1 to 2 minutes.`

  return (
    <div className="mx-auto w-full max-w-7xl pb-10">
      <div className="border-b border-border/70 pb-7">
        <button onClick={onBack} className="mb-3 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowRight className="h-4 w-4 rotate-180" /><span>Back to home</span></button>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary"><span className="h-px w-6 bg-primary" /><span>Code practice setup</span></div>
        <h1 className="mt-3 font-serif text-4xl tracking-tight text-balance sm:text-5xl">Choose topics to code with.</h1>
        <p className="mt-3 max-w-2xl text-pretty leading-7 text-muted-foreground">Pick up to {MAX_MULTI_TOPICS} topics and how to practise them: one exercise that combines them, or one exercise after another.</p>
      </div>

      <div role="radiogroup" aria-label="Exercise mode" className="mt-6 grid gap-3 md:grid-cols-2">
        {modeCards.map((card) => {
          const Icon = card.icon
          const active = mode === card.id
          return (
            <button key={card.id} type="button" role="radio" aria-checked={active} onClick={() => setMode(card.id)}
              className={`flex items-start gap-3 rounded-2xl border p-4 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'border-primary bg-primary/[0.045]' : 'border-border/70 bg-card'}`}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-primary shadow-sm"><Icon className="h-4 w-4" /></span>
              <span className="min-w-0"><span className="block text-sm font-semibold">{card.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{card.text}</span></span>
            </button>
          )
        })}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <TopicMultiSelect skillDomains={skillDomains} sampleData={sampleData} selected={selected} onToggleTopic={toggleTopic} onToggleDomain={toggleDomain} open={open} onOpenChange={setOpen} query={query} onQueryChange={setQuery} idPrefix="practice-picker" maxSelected={MAX_MULTI_TOPICS}
          maxHint={full ? `Maximum ${MAX_MULTI_TOPICS} topics selected. Remove one to pick another.` : `Choose up to ${MAX_MULTI_TOPICS} topics (max ${MAX_MULTI_TOPICS}).`}
          toolbar={<>
            <Button type="button" variant="outline" size="sm" disabled={assessedCount === 0} onClick={presetWeakest} className="min-h-10 rounded-xl"><span>Weakest topics</span></Button>
            <Button type="button" variant="outline" size="sm" disabled={fresh.length === 0} onClick={presetFresh} className="min-h-10 rounded-xl"><span>Not yet practised</span></Button>
            <Button type="button" variant="ghost" size="sm" disabled={selected.size === 0} onClick={() => setSelected(new Set())} className="min-h-10 gap-1 rounded-xl"><X className="h-3.5 w-3.5" /><span>Clear</span></Button>
          </>} />

        <Card className="h-fit rounded-3xl border-border/70 shadow-sm xl:sticky xl:top-6">
          <CardHeader>
            <div className="flex items-center justify-between gap-3"><div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"><span>Your code practice</span></div><Badge variant="secondary" className="rounded-full" aria-live="polite"><span>{topics.length} of {MAX_MULTI_TOPICS} topics</span></Badge></div>
            <CardTitle className="mt-2 text-xl"><span>{topics.length === 0 ? 'Select at least one topic.' : mode === 'integrated' && topics.length > 1 ? 'One exercise, all topics' : topics.length > 1 ? `${topics.length} exercises in a row` : 'One exercise'}</span></CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {topics.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Selected topics">
                {keys.map((key) => (
                  <li key={key}><span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-primary/30 bg-primary/[0.045] py-1 pl-3 pr-1 text-xs font-medium"><span>{label(key)}</span><button type="button" aria-label={`Remove ${label(key)}`} onClick={() => toggleTopic(key)} className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-3 w-3" /></button></span></li>
                ))}
              </ul>
            )}
            {mode === 'integrated' && domainsInSelection.size > 1 && topics.length > 1 && <p className="rounded-xl bg-muted/60 p-3 text-xs leading-5 text-muted-foreground">Topics from {[...domainsInSelection].map((id) => findDomain(id)?.label ?? id).join(' and ')}: the exercise uses one language and says which.</p>}
            <p className="rounded-xl bg-muted/60 p-3 text-xs leading-5 text-muted-foreground"><span>{waitText}</span></p>
            <Button type="button" onClick={() => { if (valid && !busy) onStart({ topics, mode }) }} disabled={!valid || busy} className="min-h-11 w-full gap-2 rounded-xl active:scale-[0.98] transition-transform">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Code2 className="h-4 w-4" />}<span>{busy ? 'Preparing exercise…' : startLabel}</span></Button>
            {sampleData && <p className="text-xs leading-5 text-muted-foreground">Example data is on, so no mastery levels are shown.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
