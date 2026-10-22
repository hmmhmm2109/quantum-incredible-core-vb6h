'use client'

import { useEffect, useState } from 'react'

import { ArrowRight, BookOpenCheck, BrainCircuit, CheckCircle2, Clock3, Code2, Compass, FlaskConical, Layers, LockKeyhole, Sparkles, Target, TerminalSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { PracticeTopic, RecentExercise } from '@/lib/home-recommendation'
import type { TopicRef } from '@/lib/practice-multi'

export type HomeDomain = {
  id: string
  label: string
  score: number
  level: string
  confidence: number
  focus: string
  caption?: string
  assessedCount?: number
  totalCount?: number
  assessedAverage?: number | null
  provisional?: boolean
  weakest?: { label: string; score: number } | null
  isReal: boolean
}

export type HomeOverall = { score: number; level: string; assessedCount: number; totalCount: number; provisional: boolean }

export type HomeAttempt = {
  id: string
  title: string
  chip: string
  meta: string
  status: string
  tone: 'good' | 'warn' | 'neutral'
  scoreLabel: string | null
  when: string
  whenFull: string
  isReal: boolean
  topics?: { domainId: string; topicId: string; label: string }[] // every topic of a multi-topic exercise
}

export type HomeRecommendation = {
  title: string
  description: string
  domain: string
  topic: string
  level: string
  format: string
  duration: number
  rationale: string
  isReal: boolean
  // When set, the primary button runs this topic action instead of opening the practice workspace.
  action?: { kind: 'assess' | 'learn'; domainId: string; topicId: string; label: string }
}

type TopicOption = { id: string; label: string }
type DomainOption = { id: string; label: string; topics: TopicOption[] }

type HomeSectionProps = {
  displayName: string
  dateLabel: string
  domains: HomeDomain[]
  overall?: HomeOverall | null
  attempts: HomeAttempt[]
  recommendation: HomeRecommendation
  sampleData: boolean
  dataError: string | null
  onStartPractice: () => void
  onOpenSkillMap: () => void
  onOpenHistory: () => void
  onStartAssessment: () => void
  domainOptions: DomainOption[]
  onStartLearningTopic: (domainId: string, topicId: string) => void
  onStartAssessmentTopic: (domainId: string, topicId: string) => void
  topicActionLoading: boolean
  // Code exercises (the other activity type): recommended topic, recent attempts, and the actions that open them.
  codePractice: { recommended: PracticeTopic | null; recent: RecentExercise[] }
  onStartCodeExercise: (domainId: string, topicId: string) => void
  onChooseTopics: (seed: TopicRef[]) => void // opens the multi-topic code-practice picker, seeded with the topic selected here
  onStartMultiExercise: (topics: TopicRef[]) => void // reopens the newest exercise of a multi-topic set
}

const levelTone: Record<string, string> = {
  Basic: 'text-muted-foreground',
  Foundation: 'text-primary',
  Intermediate: 'text-primary',
  Advanced: 'text-emerald-600 dark:text-emerald-400',
  Expert: 'text-amber-600 dark:text-amber-400',
}

function formatLevel(level: string) {
  return level || 'Awaiting diagnostic'
}

// Greeting from the viewer's local hour; neutral until mounted so the prerendered HTML matches the first client render.
function greetingForHour(hour: number) {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  if (hour >= 17 && hour < 22) return 'Good evening'
  return 'Hello'
}

export default function HomeSection({
  displayName,
  dateLabel,
  domains,
  overall,
  attempts,
  recommendation,
  sampleData,
  dataError,
  onStartPractice,
  onOpenSkillMap,
  onOpenHistory,
  onStartAssessment,
  domainOptions,
  onStartLearningTopic,
  onStartAssessmentTopic,
  topicActionLoading,
  codePractice,
  onStartCodeExercise,
  onChooseTopics,
  onStartMultiExercise,
}: HomeSectionProps) {
  const [greeting, setGreeting] = useState('Welcome back')
  useEffect(() => { setGreeting(greetingForHour(new Date().getHours())) }, [])
  const [learnDomain, setLearnDomain] = useState(domainOptions[0]?.id ?? '')
  const [learnTopic, setLearnTopic] = useState(domainOptions[0]?.topics[0]?.id ?? '')
  const [assessmentDomain, setAssessmentDomain] = useState(domainOptions[0]?.id ?? '')
  const [assessmentTopic, setAssessmentTopic] = useState(domainOptions[0]?.topics[0]?.id ?? '')
  const learnTopics = domainOptions.find((domain) => domain.id === learnDomain)?.topics ?? []
  const assessmentTopics = domainOptions.find((domain) => domain.id === assessmentDomain)?.topics ?? []
  const [codeDomain, setCodeDomain] = useState(codePractice.recommended?.domainId ?? domainOptions[0]?.id ?? '')
  const [codeTopic, setCodeTopic] = useState(codePractice.recommended?.topicId ?? domainOptions[0]?.topics[0]?.id ?? '')
  const recommendedKey = codePractice.recommended ? `${codePractice.recommended.domainId}/${codePractice.recommended.topicId}` : ''
  useEffect(() => { if (codePractice.recommended) { setCodeDomain(codePractice.recommended.domainId); setCodeTopic(codePractice.recommended.topicId) } }, [recommendedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const codeTopics = domainOptions.find((domain) => domain.id === codeDomain)?.topics ?? []
  const changeCodeDomain = (value: string) => { setCodeDomain(value); setCodeTopic(domainOptions.find((domain) => domain.id === value)?.topics[0]?.id ?? '') }
  const changeLearnDomain = (value: string) => { setLearnDomain(value); setLearnTopic(domainOptions.find((domain) => domain.id === value)?.topics[0]?.id ?? '') }
  const changeAssessmentDomain = (value: string) => { setAssessmentDomain(value); setAssessmentTopic(domainOptions.find((domain) => domain.id === value)?.topics[0]?.id ?? '') }
  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 pb-10">
      <div className="flex flex-col gap-5 border-b border-border/70 pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="h-px w-7 bg-primary" />
            Adaptive practice · {dateLabel || 'Your learning desk'}
          </div>
          <div>
            <h1 className="font-serif text-4xl tracking-tight text-balance sm:text-5xl">{greeting}, {displayName}.</h1>
            <p className="mt-3 max-w-2xl text-pretty text-base leading-7 text-muted-foreground">
              Build evidence one exercise at a time. The coach keeps each domain independent so your next challenge meets you where you are.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {sampleData && <Badge variant="outline" className="gap-1.5 rounded-full px-3 py-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" />Examples fill empty areas</Badge>}
          <Button onClick={onStartAssessment} variant="outline" className="min-h-10 gap-2 rounded-xl px-4 active:scale-[0.98] transition-transform">
            <BrainCircuit className="h-4 w-4" />
            Start a quiz
          </Button>
        </div>
      </div>

      {dataError && (
        <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          <TerminalSquare className="mt-0.5 h-4 w-4 shrink-0" />
          <div><span className="font-semibold">Saved data is unavailable.</span> {dataError} You can still explore the sample path, then retry.</div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-3xl border-border/70 shadow-sm">
          <CardHeader><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Learn a topic</div><CardTitle className="mt-2 flex items-center gap-2 text-xl"><BookOpenCheck className="h-5 w-5 text-primary" />Theory before practice</CardTitle></CardHeader>
          <CardContent className="space-y-4"><p className="text-sm leading-6 text-muted-foreground">Choose one topic. The AI CLI generates the explanation, guided example, quick check, then a focused exercise.</p><div className="grid gap-3 sm:grid-cols-2"><select aria-label="Learning domain" value={learnDomain} onChange={(event) => changeLearnDomain(event.target.value)} className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm">{domainOptions.map((domain) => <option key={domain.id} value={domain.id}>{domain.label}</option>)}</select><select aria-label="Learning topic" value={learnTopic} onChange={(event) => setLearnTopic(event.target.value)} className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm">{learnTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.label}</option>)}</select></div><Button disabled={topicActionLoading || !learnTopic} onClick={() => onStartLearningTopic(learnDomain, learnTopic)} className="min-h-11 w-full gap-2 rounded-xl"><BookOpenCheck className="h-4 w-4" /><span>{topicActionLoading ? 'Preparing lesson…' : 'Start lesson'}</span></Button></CardContent>
        </Card>
        <Card className="rounded-3xl border-border/70 shadow-sm">
          <CardHeader><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Quiz · multiple choice</div><CardTitle className="mt-2 flex items-center gap-2 text-xl"><Target className="h-5 w-5 text-primary" />Topic-only assessment</CardTitle></CardHeader>
          <CardContent className="space-y-4"><p className="text-sm leading-6 text-muted-foreground">A short multiple-choice quiz on one topic (not a code exercise). Questions and mastery evidence stay inside the chosen topic.</p><div className="grid gap-3 sm:grid-cols-2"><select aria-label="Assessment domain" value={assessmentDomain} onChange={(event) => changeAssessmentDomain(event.target.value)} className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm">{domainOptions.map((domain) => <option key={domain.id} value={domain.id}>{domain.label}</option>)}</select><select aria-label="Assessment topic" value={assessmentTopic} onChange={(event) => setAssessmentTopic(event.target.value)} className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm">{assessmentTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.label}</option>)}</select></div><Button disabled={!assessmentTopic} onClick={() => onStartAssessmentTopic(assessmentDomain, assessmentTopic)} variant="outline" className="min-h-11 w-full gap-2 rounded-xl"><BrainCircuit className="h-4 w-4" />Start topic assessment</Button></CardContent>
        </Card>
      </div>

      <Card className="rounded-3xl border-border/70 shadow-sm" data-testid="code-practice">
        <CardHeader><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Code exercise · hands-on</div><CardTitle className="mt-2 flex items-center gap-2 text-xl"><Code2 className="h-5 w-5 text-primary" />Code practice</CardTitle></CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">A written coding task with hints and coach feedback, different from a quiz. {sampleData ? 'Sample mode opens the example exercise.' : codePractice.recommended ? <>Suggested: <span className="font-medium text-foreground">{codePractice.recommended.topicLabel}</span> ({codePractice.recommended.domainLabel}). {codePractice.recommended.reason}</> : 'Pick a topic to start; the exercise is written once and reused.'}</p>
            {!sampleData && <div className="grid gap-3 sm:grid-cols-2"><select aria-label="Code exercise domain" value={codeDomain} onChange={(event) => changeCodeDomain(event.target.value)} className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm">{domainOptions.map((domain) => <option key={domain.id} value={domain.id}>{domain.label}</option>)}</select><select aria-label="Code exercise topic" value={codeTopic} onChange={(event) => setCodeTopic(event.target.value)} className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm">{codeTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.label}</option>)}</select></div>}
            <div className="flex flex-wrap gap-2"><Button disabled={topicActionLoading || (!sampleData && !codeTopic)} onClick={() => sampleData ? onStartPractice() : onStartCodeExercise(codeDomain, codeTopic)} className="min-h-11 gap-2 rounded-xl"><Code2 className="h-4 w-4" /><span>{topicActionLoading ? 'Preparing exercise…' : 'Start a code exercise'}</span></Button><Button onClick={onOpenSkillMap} variant="outline" className="min-h-11 gap-2 rounded-xl"><Compass className="h-4 w-4" />Choose in Skill Map</Button>{!sampleData && <Button onClick={() => onChooseTopics(codeTopic ? [{ domain_id: codeDomain, topic_id: codeTopic }] : [])} disabled={topicActionLoading} variant="outline" className="min-h-11 gap-2 rounded-xl"><Layers className="h-4 w-4" /><span>Choose topics…</span></Button>}</div>{!sampleData && <p className="text-xs leading-5 text-muted-foreground">Need more than one topic? <span className="font-medium text-foreground">Choose topics…</span> combines up to 4 into one exercise, or runs them one after another.</p>}
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Recent code exercises</div>
            {codePractice.recent.length > 0 && !sampleData ? <ul className="mt-2 divide-y divide-border/70">{codePractice.recent.map((exercise) => <li key={exercise.id} className="flex items-center justify-between gap-3 py-2.5"><div className="min-w-0"><div className="truncate text-sm font-medium">{exercise.topicLabel}</div><div className="text-xs text-muted-foreground">{exercise.kind} · {exercise.domainLabel} · {new Date(exercise.when).toLocaleDateString()} · <span className={exercise.status === 'Passed' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>{exercise.status}</span></div></div><Button size="sm" variant="outline" disabled={topicActionLoading} className="min-h-9 shrink-0 rounded-xl" onClick={() => exercise.topics ? onStartMultiExercise(exercise.topics) : onStartCodeExercise(exercise.domainId, exercise.topicId)}>{exercise.status === 'Passed' ? 'Practice again' : 'Continue'}</Button></li>)}</ul> : <p className="mt-2 rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">No code exercises yet. Start one on the left.</p>}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.55fr_0.95fr]">
        <Card className="overflow-hidden rounded-3xl border-border/70 bg-card shadow-sm">
          <CardContent className="p-0">
            <div className="border-b border-border/70 bg-primary/[0.045] p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Recommended next</div>
                <Badge variant="secondary" className="rounded-full">{recommendation.isReal ? 'Saved recommendation' : 'Sample path'}</Badge>
              </div>
              <h2 className="mt-5 max-w-2xl font-serif text-3xl tracking-tight text-balance sm:text-4xl">{recommendation.title}</h2>
              <p className="mt-3 max-w-2xl text-pretty leading-7 text-muted-foreground">{recommendation.description}</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Badge variant="outline" className="rounded-full">{recommendation.domain}</Badge>
                <Badge variant="outline" className="rounded-full">{recommendation.topic}</Badge>
                <Badge variant="outline" className="rounded-full">{recommendation.level}</Badge>
                <Badge variant="outline" className="rounded-full">{recommendation.format}</Badge>
                <Badge variant="outline" className="gap-1 rounded-full"><Clock3 className="h-3 w-3" />{recommendation.duration} min</Badge>
              </div>
            </div>
            <div className="space-y-5 p-6 sm:p-8">
              <div className="border-l-2 border-primary pl-4 text-sm leading-6 text-muted-foreground">
                <span className="font-semibold text-foreground">Why this?</span><br />
                {recommendation.rationale}
              </div>
              <Button onClick={() => recommendation.action ? (recommendation.action.kind === 'assess' ? onStartAssessmentTopic : onStartLearningTopic)(recommendation.action.domainId, recommendation.action.topicId) : onStartPractice()} disabled={Boolean(recommendation.action) && topicActionLoading} className="min-h-11 gap-2 rounded-xl px-5 shadow-sm active:scale-[0.98] transition-transform">
                {recommendation.action?.label ?? 'Start a code exercise'} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/70 shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Independent tracks</div>
              <CardTitle className="mt-2 text-xl">Your domains</CardTitle>
            </div>
            <Compass className="h-5 w-5 text-primary" />
          </CardHeader>
          <CardContent className="space-y-5">
            {domains.length > 0 ? domains.map((domain) => {
              const boundedScore = Math.max(0, Math.min(100, domain.score))
              return (
                <div key={domain.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold">{domain.label}</span>
                    <span className={`text-xs font-medium ${levelTone[domain.level] ?? 'text-muted-foreground'}`}>{formatLevel(domain.level)}</span>
                  </div>
                  {domain.totalCount !== undefined ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <Badge variant="outline" className="rounded-full font-normal"><span>{`Assessed ${domain.assessedCount ?? 0} of ${domain.totalCount}`}</span></Badge>
                      {domain.provisional && <Badge variant="secondary" className="rounded-full font-normal"><span>{`Provisional · ${domain.assessedCount} of ${domain.totalCount} assessed`}</span></Badge>}
                    </div>
                  ) : domain.caption && <div className="text-xs text-muted-foreground">{domain.caption}</div>}
                  <div className="flex items-center gap-3">
                    <Progress value={boundedScore} className="h-2 flex-1" aria-label={`${domain.label} ${boundedScore}%`} />
                    <span className="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground">{boundedScore}%</span>
                  </div>
                  {domain.weakest && <div className="text-xs text-muted-foreground"><span>{`Weakest: ${domain.weakest.label} ${domain.weakest.score}%`}</span>{domain.assessedAverage != null && <span>{` · Assessed average ${domain.assessedAverage}%`}</span>}</div>}
                </div>
              )
            }) : (
              <div className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">Your first diagnostic will create topic-level evidence across all enabled packs.</div>
            )}
            {overall && overall.assessedCount > 0 && <div className="rounded-2xl bg-muted/60 p-3 text-xs leading-5 text-muted-foreground"><span className="font-semibold text-foreground">{`Overall ${overall.level} · ${overall.score}%`}</span><span>{` across all ${overall.totalCount} topics (${overall.assessedCount} assessed).`}</span></div>}
            {domains.some((domain) => domain.totalCount !== undefined) && <p className="text-xs leading-5 text-muted-foreground">Level is the average across all topics in a domain; unassessed topics count as 0.</p>}
            <Button onClick={onOpenSkillMap} variant="outline" className="mt-1 min-h-11 w-full gap-2 rounded-xl active:scale-[0.98] transition-transform">
              Inspect skill map <ArrowRight className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-3xl border-border/70 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Evidence trail</div>
              <CardTitle className="mt-2 text-xl">Recent code attempts</CardTitle>
            </div>
            <Button onClick={onOpenHistory} variant="ghost" className="min-h-10 gap-1.5 rounded-xl px-3 text-sm text-muted-foreground hover:text-foreground">View history <ArrowRight className="h-3.5 w-3.5" /></Button>
          </CardHeader>
          <CardContent>
            {attempts.length > 0 ? (
              <div className="divide-y divide-border/70">
                {attempts.slice(0, 5).map((attempt) => (
                  <div key={attempt.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${attempt.tone === 'good' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : attempt.tone === 'warn' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}>
                        {attempt.tone === 'good' ? <CheckCircle2 className="h-4 w-4" /> : <Code2 className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0">
                        <div className="line-clamp-2 font-medium" title={attempt.title}>{attempt.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{attempt.topics && attempt.topics.length > 0 ? attempt.topics.map((entry) => <Badge key={`${entry.domainId}/${entry.topicId}`} variant="secondary" className="rounded-full px-2 py-0 text-[10px] font-normal">{entry.label}</Badge>) : <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px] font-normal">{attempt.chip}</Badge>}<span>{attempt.meta}</span>{!attempt.isReal && <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px]">Example</Badge>}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 pl-11 text-sm sm:pl-0"><span className={`font-semibold ${attempt.tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : attempt.tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{attempt.status}{attempt.scoreLabel && <span className="ml-1.5 font-mono text-xs font-normal tabular-nums">{attempt.scoreLabel}</span>}</span><span title={attempt.whenFull} className="text-xs tabular-nums text-muted-foreground">{attempt.when}</span></div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-muted/60 p-5 text-sm text-muted-foreground">No saved attempts yet. Open the recommended workspace to start building evidence.</div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/70 bg-muted/40 shadow-none">
          <CardHeader className="pb-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Assessment modes</div>
            <CardTitle className="mt-2 text-xl">Check the map, not just memory.</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-primary shadow-sm"><Target className="h-4 w-4" /></span><div><div className="text-sm font-semibold">Knowledge check</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Five adaptive questions after a practice gap.</p></div></div>
            <div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-primary shadow-sm"><FlaskConical className="h-4 w-4" /></span><div><div className="text-sm font-semibold">Domain assessment</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Broader evidence with a bounded mastery impact.</p></div></div>
            <div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-background text-primary shadow-sm"><LockKeyhole className="h-4 w-4" /></span><div><div className="text-sm font-semibold">Expert challenge</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Deep, cross-domain scenarios with hidden answers.</p></div></div>
            <Button onClick={onStartAssessment} variant="secondary" className="min-h-10 w-full rounded-xl active:scale-[0.98] transition-transform">Choose a mode</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
