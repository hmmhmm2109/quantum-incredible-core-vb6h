'use client'

import { useState } from 'react'

import { ArrowRight, BookOpenCheck, BrainCircuit, CheckCircle2, Clock3, Code2, Compass, FlaskConical, LockKeyhole, Sparkles, Target, TerminalSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

export type HomeDomain = {
  id: string
  label: string
  score: number
  level: string
  confidence: number
  focus: string
  isReal: boolean
}

export type HomeAttempt = {
  id: string
  title: string
  meta: string
  status: string
  duration: string
  isReal: boolean
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
}

type TopicOption = { id: string; label: string }
type DomainOption = { id: string; label: string; topics: TopicOption[] }

type HomeSectionProps = {
  displayName: string
  dateLabel: string
  domains: HomeDomain[]
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

export default function HomeSection({
  displayName,
  dateLabel,
  domains,
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
}: HomeSectionProps) {
  const [learnDomain, setLearnDomain] = useState(domainOptions[0]?.id ?? '')
  const [learnTopic, setLearnTopic] = useState(domainOptions[0]?.topics[0]?.id ?? '')
  const [assessmentDomain, setAssessmentDomain] = useState(domainOptions[0]?.id ?? '')
  const [assessmentTopic, setAssessmentTopic] = useState(domainOptions[0]?.topics[0]?.id ?? '')
  const learnTopics = domainOptions.find((domain) => domain.id === learnDomain)?.topics ?? []
  const assessmentTopics = domainOptions.find((domain) => domain.id === assessmentDomain)?.topics ?? []
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
            <h1 className="font-serif text-4xl tracking-tight text-balance sm:text-5xl">Good morning, {displayName}.</h1>
            <p className="mt-3 max-w-2xl text-pretty text-base leading-7 text-muted-foreground">
              Build evidence one exercise at a time. The coach keeps each domain independent so your next challenge meets you where you are.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {sampleData && <Badge variant="outline" className="gap-1.5 rounded-full px-3 py-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" />Examples fill empty areas</Badge>}
          <Button onClick={onStartAssessment} variant="outline" className="min-h-10 gap-2 rounded-xl px-4 active:scale-[0.98] transition-transform">
            <BrainCircuit className="h-4 w-4" />
            Start assessment
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
          <CardContent className="space-y-4"><p className="text-sm leading-6 text-muted-foreground">Choose one topic. Claude CLI generates the explanation, guided example, quick check, then a focused exercise.</p><div className="grid gap-3 sm:grid-cols-2"><select aria-label="Learning domain" value={learnDomain} onChange={(event) => changeLearnDomain(event.target.value)} className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm">{domainOptions.map((domain) => <option key={domain.id} value={domain.id}>{domain.label}</option>)}</select><select aria-label="Learning topic" value={learnTopic} onChange={(event) => setLearnTopic(event.target.value)} className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm">{learnTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.label}</option>)}</select></div><Button disabled={topicActionLoading || !learnTopic} onClick={() => onStartLearningTopic(learnDomain, learnTopic)} className="min-h-11 w-full gap-2 rounded-xl"><BookOpenCheck className="h-4 w-4" />{topicActionLoading ? 'Preparing lesson…' : 'Start lesson'}</Button></CardContent>
        </Card>
        <Card className="rounded-3xl border-border/70 shadow-sm">
          <CardHeader><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Assess one topic</div><CardTitle className="mt-2 flex items-center gap-2 text-xl"><Target className="h-5 w-5 text-primary" />Topic-only assessment</CardTitle></CardHeader>
          <CardContent className="space-y-4"><p className="text-sm leading-6 text-muted-foreground">This selection is independent from learning. Questions and mastery evidence stay inside the chosen topic.</p><div className="grid gap-3 sm:grid-cols-2"><select aria-label="Assessment domain" value={assessmentDomain} onChange={(event) => changeAssessmentDomain(event.target.value)} className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm">{domainOptions.map((domain) => <option key={domain.id} value={domain.id}>{domain.label}</option>)}</select><select aria-label="Assessment topic" value={assessmentTopic} onChange={(event) => setAssessmentTopic(event.target.value)} className="min-h-11 rounded-xl border border-input bg-background px-3 text-sm">{assessmentTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.label}</option>)}</select></div><Button disabled={!assessmentTopic} onClick={() => onStartAssessmentTopic(assessmentDomain, assessmentTopic)} variant="outline" className="min-h-11 w-full gap-2 rounded-xl"><BrainCircuit className="h-4 w-4" />Start topic assessment</Button></CardContent>
        </Card>
      </div>

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
              <Button onClick={onStartPractice} className="min-h-11 gap-2 rounded-xl px-5 shadow-sm active:scale-[0.98] transition-transform">
                Open practice workspace <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/70 shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Five independent tracks</div>
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
                  <div className="flex items-center gap-3">
                    <Progress value={boundedScore} className="h-2 flex-1" aria-label={`${domain.label} ${boundedScore}%`} />
                    <span className="w-10 text-right font-mono text-xs tabular-nums text-muted-foreground">{boundedScore}%</span>
                  </div>
                </div>
              )
            }) : (
              <div className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">Your first diagnostic will create topic-level evidence across all enabled packs.</div>
            )}
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
              <CardTitle className="mt-2 text-xl">Recent attempts</CardTitle>
            </div>
            <Button onClick={onOpenHistory} variant="ghost" className="min-h-10 gap-1.5 rounded-xl px-3 text-sm text-muted-foreground hover:text-foreground">View history <ArrowRight className="h-3.5 w-3.5" /></Button>
          </CardHeader>
          <CardContent>
            {attempts.length > 0 ? (
              <div className="divide-y divide-border/70">
                {attempts.slice(0, 5).map((attempt) => (
                  <div key={attempt.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${attempt.status === 'Passed' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
                        {attempt.status === 'Passed' ? <CheckCircle2 className="h-4 w-4" /> : <Code2 className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{attempt.title}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{attempt.meta}</span>{!attempt.isReal && <Badge variant="outline" className="rounded-full px-2 py-0 text-[10px]">Example</Badge>}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-5 pl-11 text-sm sm:pl-0"><span className={attempt.status === 'Passed' ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-amber-700 dark:text-amber-400'}>{attempt.status}</span><span className="font-mono text-xs tabular-nums text-muted-foreground">{attempt.duration}</span></div>
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
