'use client'

import { InlineText, PromptText } from '@/components/RichText'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronRight, CircleHelp, Code2, FileCode2, FileText, FlaskConical, Lightbulb, Loader2, LockKeyhole, Play, RefreshCw, Save, Send, ShieldCheck, Terminal, X } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { findDomain, topicLabel } from '@/lib/taxonomy'
import { useAiProvider } from '@/hooks/use-ai-provider'
import { composeAnswer, splitAnswer } from '@/lib/starter-answer'

type StarterFile = { path: string; content: string }
type RubricItem = { criterion: string; weight: number; evidence: string }
type TestPlanItem = { name: string; purpose: string; visibility: string }
type ExecutionProfile = { runtime: string; language: string | null; allowed_actions: string[]; time_limit_seconds: number; network: string }

export type PracticeActivity = {
  id: string | null
  domain_id: string | null
  topic_id: string | null
  domain: string | null
  topic: string | null
  pack_version: string | null
  level_band: string | null
  format: string | null
  prerequisites: string[]
  estimated_duration_minutes: number
  learning_objectives: string[]
  prompt: string | null
  constraints: string[]
  starter_files: StarterFile[]
  execution_profile: ExecutionProfile
  test_plan: TestPlanItem[]
  rubric: RubricItem[]
}

type Hint = { stage: number; label: string; content: string; revealed: boolean }
type ClaudeState = { available: boolean; status: string; notice: string; job_id: string | null; exit_code: number | null; stdout: string; stderr: string; changed_files: { path: string; change: string }[] }

export type AssessmentQuestion = {
  stem: string
  options: string[]
  type: string
  artifact?: string | null
}

export type PracticeSectionProps = {
  mode: 'practice' | 'assessment'
  activity: PracticeActivity
  hints: Hint[]
  claude: ClaudeState
  assessmentQuestion: AssessmentQuestion
  assessmentIndex: number
  assessmentTotal: number
  generatedCount?: number
  missingSlots?: { slot: number; reason: string }[]
  retrying?: boolean
  onRetryMissing?: () => void
  onRestartAssessment?: () => void // set only while a resumed session is on screen
  restarting?: boolean
  assessmentCoverage: { domain_id: string; topic_id: string; weight: number; subtopics: string[]; slots: number[] }[]
  assessmentProgress?: { slot: number; domain_id: string; topic_id: string; subtopic: string; answeredSlots: number[] } | null
  assessmentMeta: { mode: string; blueprint_id: string | null; blueprint_version: string | null; calibrated_difficulty: { score: number }; validation_state: string; answer_rules: { type: string; partial_credit: string }; mastery_impact_cap: { max_level_band_delta: number; max_score_delta: number } }
  answerText: string
  justification: string
  selectedAnswers: string[]
  confidence: string
  loading: boolean
  saving: boolean
  statusMessage: string | null
  onChangeAnswer: (value: string) => void
  onChangeJustification: (value: string) => void
  onChangeConfidence: (value: string) => void
  onToggleAnswer: (value: string) => void
  onRevealHint: () => void
  onRun: () => void
  onSaveDraft: () => void
  onSubmit: () => void
  onNextAssessment: () => void
  currentAnswered?: boolean
  onReplaceQuestion?: () => void // swaps the unanswered question on screen for a new one on the same topic
  replacing?: boolean
  onBack: () => void
  onStartClaude: () => void
  onCancelClaude: () => void
}

function safeLabel(value: string | null | undefined, fallback: string) {
  return value && value.trim() ? value : fallback
}

function codeLanguage(activity: PracticeActivity) {
  const language = activity.execution_profile?.language
  return language || (activity.format === 'linux_lab' ? 'shell' : 'c')
}

function HintRail({ hints, onRevealHint }: { hints: Hint[]; onRevealHint: () => void }) {
  const revealed = hints.filter((hint) => hint.revealed)
  const nextHint = hints.find((hint) => !hint.revealed)
  return (
    <div className="mt-7 rounded-2xl border border-primary/20 bg-primary/[0.045] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4 text-primary" />Staged help</div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><span>{`${revealed.length}/${hints.length} revealed`}</span></span>
      </div>
      {hints.length === 0 ? <p className="mt-3 text-sm leading-6 text-muted-foreground">No hints for this exercise.</p> : <>
        {revealed.length > 0 ? (
          <div className="mt-4 space-y-3">
            {revealed.map((hint) => <div key={hint.stage} className="rounded-xl bg-background/80 p-3 text-sm leading-6 text-muted-foreground"><div className="mb-1 text-xs font-semibold text-foreground">Hint {hint.stage} · {hint.label}</div><InlineText text={hint.content} /></div>)}
          </div>
        ) : <p className="mt-3 text-sm leading-6 text-muted-foreground">Ask for the smallest nudge first. The coach keeps the solution concealed until you need it.</p>}
        <Button onClick={onRevealHint} disabled={!nextHint} variant="outline" className="mt-4 min-h-10 w-full rounded-xl active:scale-[0.98] transition-transform"><span>{nextHint ? `Reveal hint ${revealed.length + 1} of ${hints.length}` : 'All hints revealed'}</span><ChevronRight className="ml-auto h-4 w-4" /></Button>
      </>}
    </div>
  )
}

function BriefPane({ activity, hints, onRevealHint, activeFile, onOpenFile }: { activity: PracticeActivity; hints: Hint[]; onRevealHint: () => void; activeFile: string | null; onOpenFile: (path: string) => void }) {
  return (
    <section className="min-w-0 overflow-y-auto bg-card px-5 py-6 sm:px-7 lg:h-[calc(100vh-8.75rem)] lg:min-h-[42rem]">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary"><span className="h-px w-6 bg-primary" />{safeLabel(activity.format, 'Adaptive exercise')}</div>
      <h2 className="mt-4 font-serif text-3xl tracking-tight text-balance">{safeLabel(activity.topic, 'Start with a diagnostic')}</h2>
      <div className="mt-3 flex flex-wrap gap-2"><Badge variant="secondary" className="rounded-full">{safeLabel(activity.domain, 'Embedded systems')}</Badge><Badge variant="outline" className="rounded-full">{safeLabel(activity.level_band, 'Basic')}</Badge><Badge variant="outline" className="rounded-full">{activity.estimated_duration_minutes} min</Badge></div>
      <PromptText className="mt-5 text-muted-foreground" text={safeLabel(activity.prompt, 'Complete the prompt, explain your reasoning, and use the feedback to choose what to study next.')} />
      <div className="mt-7 space-y-7">
        <div><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Check className="h-4 w-4 text-primary" />Learning objectives</div><ul className="space-y-2 text-sm leading-6 text-muted-foreground">{activity.learning_objectives.map((objective, index) => <li key={`${objective}-${index}`} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" /><InlineText text={objective} /></li>)}</ul></div>
        <div><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-primary" />Constraints</div>{activity.constraints.length > 0 ? <ul className="space-y-2 text-sm leading-6 text-muted-foreground">{activity.constraints.map((constraint, index) => <li key={`${constraint}-${index}`} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" /><InlineText text={constraint} /></li>)}</ul> : <p className="text-sm text-muted-foreground">The coach will disclose task-specific safety constraints before execution.</p>}</div>
        <div><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><FileCode2 className="h-4 w-4 text-primary" />Starter files</div>{activity.starter_files.length > 0 ? <div className="space-y-2">{activity.starter_files.map((file) => <button key={file.path} type="button" onClick={() => onOpenFile(file.path)} aria-pressed={activeFile === file.path} className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeFile === file.path ? 'border-primary/50 bg-primary/5' : 'border-border/70'}`}><span translate="no" className="flex min-w-0 items-center gap-2 truncate font-mono text-xs"><FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />{file.path}</span><Badge variant="outline" className="rounded-full"><span>{file.content.trim() ? 'open' : 'to create'}</span></Badge></button>)}</div> : <p className="text-sm text-muted-foreground">No starter files; answer in the workspace.</p>}</div>
        <div><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><FlaskConical className="h-4 w-4 text-primary" />Test plan</div>{activity.test_plan.length > 0 ? <div className="space-y-2">{activity.test_plan.map((test) => <div key={test.name} className="rounded-xl bg-muted/60 p-3"><div className="flex items-center justify-between gap-3 text-sm font-medium"><span><InlineText text={test.name} /></span><Badge variant={test.visibility === 'hidden' ? 'outline' : 'secondary'} className="rounded-full">{test.visibility}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground"><InlineText text={test.purpose} /></p></div>)}</div> : <p className="text-sm text-muted-foreground">The coach will attach public checks when the task is generated.</p>}</div>
      </div>
      <HintRail hints={hints} onRevealHint={onRevealHint} />
    </section>
  )
}

function EditorPane({ activity, value, onChange, activeFile, onSelectFile }: { activity: PracticeActivity; value: string; onChange: (value: string) => void; activeFile: string | null; onSelectFile: (path: string | null) => void }) {
  const files = activity.starter_files
  const { approach, files: edits } = splitAnswer(value)
  const current = files.find((file) => file.path === activeFile) ?? null
  const text = current ? edits[current.path] ?? current.content : approach
  const noContent = files.length > 0 && files.every((file) => !file.content.trim())
  const change = (next: string) => onChange(current ? composeAnswer(approach, { ...edits, [current.path]: next }, files) : composeAnswer(next, edits, files))
  const tabClass = (on: boolean) => `shrink-0 border-b-2 px-3 py-2 font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? 'border-primary text-slate-100' : 'border-transparent text-slate-400 hover:text-slate-200'}`
  return (
    <div className="flex min-h-[24rem] flex-1 flex-col bg-slate-950 text-slate-100 dark:bg-black">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 pt-2"><div role="tablist" aria-label="Files" className="flex min-w-0 items-center overflow-x-auto"><button role="tab" aria-selected={!current} onClick={() => onSelectFile(null)} className={tabClass(!current)}><span>Your answer</span></button>{files.map((file) => <button key={file.path} role="tab" aria-selected={current?.path === file.path} onClick={() => onSelectFile(file.path)} className={tabClass(current?.path === file.path)}><span translate="no">{file.path}</span>{edits[file.path] !== undefined && edits[file.path] !== file.content && <span className="ml-1 text-primary" aria-label="edited">●</span>}</button>)}</div><Badge variant="outline" className="mb-2 shrink-0 rounded-full border-white/15 text-slate-300">{current ? codeLanguage(activity) : 'notes'}</Badge></div>
      {current && <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2 text-xs text-slate-400"><span>{current.content.trim() ? 'Starter file: edit it here; changed files are sent with your answer.' : 'Empty file: write it here; it is sent with your answer.'}</span>{edits[current.path] !== undefined && edits[current.path] !== current.content && <button onClick={() => onChange(composeAnswer(approach, Object.fromEntries(Object.entries(edits).filter(([path]) => path !== current.path)), files))} className="ml-auto underline underline-offset-2 hover:text-slate-200"><span>Reset file</span></button>}</div>}
      {noContent && <div className="border-b border-white/10 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">Starter content is not available for this exercise. Regenerate the practice from the lesson to get the files.</div>}
      <Textarea key={current?.path ?? 'answer'} translate={current ? 'no' : undefined} value={text} onChange={(event) => change(event.target.value)} aria-label={current ? `Editor for ${current.path}` : 'Practice response editor'} spellCheck={false} className="min-h-[20rem] flex-1 resize-y rounded-none border-0 bg-transparent p-5 font-mono text-[13px] leading-7 text-slate-100 shadow-none focus-visible:ring-0" placeholder={current ? '' : 'Write your approach here…'} />
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3 font-mono text-[10px] text-slate-400"><span>Sandbox isolated</span><span className="text-white/20">·</span><span>{activity.execution_profile.time_limit_seconds}s limit</span><span className="text-white/20">·</span><span>network {activity.execution_profile.network}</span></div>
    </div>
  )
}

function TerminalPane({ statusMessage, claude }: { statusMessage: string | null; claude: ClaudeState }) {
  return <div className="min-h-[10rem] border-t border-white/10 bg-slate-900 p-4 font-mono text-xs leading-6 text-slate-300 dark:bg-slate-950"><div className="mb-2 flex items-center gap-2 text-slate-500"><Terminal className="h-3.5 w-3.5" />Execution output</div>{statusMessage ? <div className="text-emerald-300">$ {statusMessage}</div> : <div className="text-slate-500">$ Waiting for an isolated run. Public test output will appear here.</div>}{claude.status !== 'pending_mcp' && claude.stdout && <pre translate="no" className="mt-2 whitespace-pre-wrap text-emerald-300">{claude.stdout}</pre>}{claude.stderr && <pre translate="no" className="mt-2 whitespace-pre-wrap text-amber-300">{claude.stderr}</pre>}</div>
}

function ClaudePane({ claude, onStart, onCancel }: { claude: ClaudeState; onStart: () => void; onCancel: () => void }) {
  const ai = useAiProvider()
  const running = claude.status === 'running'
  return <div className="space-y-4 bg-slate-950 p-5 text-slate-100 dark:bg-black"><div className="flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><Terminal className="h-4 w-4" /></div><div><div className="font-semibold">{ai.label} tutor runtime</div><p className="mt-1 text-sm leading-6 text-slate-400">Lessons, guided examples, feedback, and assessments run through {ai.label} using the host's existing login. No Lyzr API is used.</p></div></div><div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-slate-300">{claude.notice || `Ready to execute through ${ai.label}.`}</div><div className="grid gap-3 text-xs text-slate-400 sm:grid-cols-2"><div><div className="mb-1 text-slate-500">Learning flow</div><div className="font-mono text-slate-300">theory → example → check → practice</div></div><div><div className="mb-1 text-slate-500">Authentication</div><div className="font-mono text-slate-300">Linux host OAuth session</div></div></div><div className="flex flex-wrap gap-2">{running ? <Button onClick={onCancel} variant="outline" className="min-h-10 gap-2 rounded-xl border-white/15 text-slate-100 hover:bg-white/10"><X className="h-4 w-4" />Cancel request</Button> : <Button onClick={onStart} variant="secondary" className="min-h-10 gap-2 rounded-xl"><Play className="h-4 w-4" />Runtime ready</Button>}<Badge variant="outline" className="rounded-full border-white/15 text-slate-400">{claude.status}</Badge></div>{claude.changed_files.length > 0 && <div className="border-t border-white/10 pt-4"><div className="mb-2 text-xs font-semibold text-slate-300">Changed files</div>{claude.changed_files.map((file) => <div key={file.path} className="flex items-center justify-between gap-3 py-1 font-mono text-xs"><span>{file.path}</span><span className="text-slate-500">{file.change}</span></div>)}</div>}</div>
}

function AssessmentPane({ question, answerText, justification, confidence, selectedAnswers, onChangeAnswer, onChangeJustification, onChangeConfidence, onToggleAnswer }: { question: AssessmentQuestion; answerText: string; justification: string; confidence: string; selectedAnswers: string[]; onChangeAnswer: (value: string) => void; onChangeJustification: (value: string) => void; onChangeConfidence: (value: string) => void; onToggleAnswer: (value: string) => void }) {
  const isMulti = question.type === 'multiple_answer'
  return <div className="space-y-6 bg-background p-5 sm:p-7"><div className="flex flex-wrap items-center gap-2"><Badge className="rounded-full">{question.type.replaceAll('_', ' ')}</Badge><span className="text-xs text-muted-foreground">Correctness stays hidden until review.</span></div><div><h2 className="text-xl font-semibold leading-8 text-balance"><InlineText text={question.stem} /></h2>{question.artifact && <pre translate="no" className="mt-4 overflow-x-auto rounded-2xl bg-muted p-4 font-mono text-xs leading-6">{question.artifact}</pre>}</div>{isMulti ? <div className="space-y-3">{question.options.map((option) => <label key={option} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 p-4 transition-colors hover:bg-muted/60"><input type="checkbox" checked={selectedAnswers.includes(option)} onChange={() => onToggleAnswer(option)} className="mt-1 h-4 w-4 accent-primary" /><span className="text-sm leading-6"><InlineText text={option} /></span></label>)}</div> : <RadioGroup value={answerText} onValueChange={onChangeAnswer} className="space-y-3">{question.options.map((option, index) => <div key={option} className="flex items-center gap-3 rounded-xl border border-border/70 px-4 py-3 transition-colors hover:bg-muted/60"><RadioGroupItem value={option} id={`answer-${index}`} /><Label htmlFor={`answer-${index}`} className="flex-1 cursor-pointer text-sm leading-6"><InlineText text={option} /></Label></div>)}</RadioGroup>}<div className="space-y-2"><Label htmlFor="confidence">Confidence in this answer</Label><select id="confidence" value={confidence} onChange={(event) => onChangeConfidence(event.target.value)} className="flex min-h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"><option value="">Choose one</option><option value="low">Low — I am guessing</option><option value="medium">Medium — I can explain part of it</option><option value="high">High — I can defend the reasoning</option></select></div><div className="space-y-2"><Label htmlFor="justification">Justification <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="justification" value={justification} onChange={(event) => onChangeJustification(event.target.value)} className="min-h-28 rounded-xl" placeholder="What evidence led you there?" /></div></div>
}

export default function PracticeSection({ mode, activity, hints, claude, assessmentQuestion, assessmentIndex, assessmentTotal, generatedCount = assessmentTotal, missingSlots = [], retrying = false, onRetryMissing, onRestartAssessment, restarting = false, assessmentCoverage, assessmentProgress = null, assessmentMeta, answerText, justification, selectedAnswers, confidence, loading, saving, statusMessage, onChangeAnswer, onChangeJustification, onChangeConfidence, onToggleAnswer, onRevealHint, onRun, onSaveDraft, onSubmit, onNextAssessment, currentAnswered = false, onReplaceQuestion, replacing = false, onBack, onStartClaude, onCancelClaude }: PracticeSectionProps) {
  const ai = useAiProvider()
  const [tab, setTab] = useState('editor')
  const [activeFile, setActiveFile] = useState<string | null>(null) // starter file open in the editor (null = the free-text answer)
  useEffect(() => { setActiveFile(null) }, [activity.id])
  const [confirmRestart, setConfirmRestart] = useState(false)
  const title = mode === 'assessment' ? 'Adaptive assessment' : safeLabel(activity.topic, 'Practice workspace')
  const progressLabel = useMemo(() => `${assessmentIndex + 1} of ${assessmentTotal}${currentAnswered ? ' · answered' : ''}`, [assessmentIndex, assessmentTotal, currentAnswered])
  return <div className="mx-auto w-full max-w-[1500px] pb-10"><div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><button onClick={onBack} className="mb-3 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ChevronRight className="h-4 w-4 rotate-180" />Back to workspace home</button><div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-primary"><span className="h-px w-6 bg-primary" />{mode === 'assessment' ? 'No answers revealed during assessment' : 'Solve · run · review'}</div><h1 className="mt-3 font-serif text-3xl tracking-tight sm:text-4xl">{title}</h1></div><div className="flex flex-wrap items-center gap-2">{mode === 'assessment' ? <><Badge variant="outline" className="rounded-full">Question {progressLabel}</Badge>{onReplaceQuestion && !currentAnswered && <Button onClick={onReplaceQuestion} disabled={replacing || loading} variant="outline" className="min-h-10 gap-2 rounded-xl active:scale-[0.98] transition-transform">{replacing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}<span>{replacing ? 'Writing a new question…' : 'Replace this question'}</span></Button>}</> : <><Badge variant="outline" className="rounded-full">{safeLabel(activity.domain, 'Embedded')}</Badge><Badge variant="outline" className="rounded-full">{safeLabel(activity.level_band, 'Basic')}</Badge></>}<Button onClick={onSaveDraft} variant="outline" disabled={saving} className="min-h-10 gap-2 rounded-xl active:scale-[0.98] transition-transform">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}<span>{saving ? 'Saving…' : 'Save draft'}</span></Button></div></div>{mode === 'assessment' && <div className="mb-5 grid gap-4 rounded-2xl border border-border/70 bg-card p-4 sm:grid-cols-3"><div className="min-w-0"><div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Session coverage</div><div className="mt-2 space-y-2">{assessmentCoverage.map((coverage) => { const answered = assessmentProgress?.answeredSlots ?? []; const isCurrent = assessmentProgress ? coverage.slots.includes(assessmentProgress.slot) : false; const isDone = coverage.slots.length > 0 && coverage.slots.every((slot) => answered.includes(slot)); return <div key={`${coverage.domain_id}-${coverage.topic_id}`} className={`min-w-0 ${!isCurrent && !isDone && assessmentProgress ? 'opacity-60' : ''}`}><div className="flex flex-wrap items-center gap-1.5"><Badge variant={isCurrent ? 'default' : 'secondary'} className={`max-w-full rounded-full text-[10px] ${isCurrent ? 'font-semibold ring-2 ring-primary/30' : ''}`}><span className="truncate">{isDone && <span>✓ </span>}{findDomain(coverage.domain_id)?.label ?? coverage.domain_id} · {topicLabel(coverage.domain_id, coverage.topic_id)}{coverage.weight > 1 ? ` ×${coverage.weight}` : ''}</span></Badge>{isCurrent && <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-primary">current</span>}</div>{coverage.subtopics.length > 0 && <ul className="mt-1.5 space-y-0.5 text-[11px] leading-4 text-muted-foreground">{coverage.subtopics.map((subtopic, index) => { const slot = coverage.slots[index]; return <li key={`${subtopic}-${index}`} className={assessmentProgress?.slot === slot ? 'font-semibold text-foreground' : ''}>{answered.includes(slot) && '✓ '}{coverage.weight > 1 ? `Q${slot + 1}: ` : ''}{subtopic}</li> })}</ul>}</div> })}</div></div><div className="min-w-0"><div className="font-mono text-[10px] uppercase tracking-[0.14em] text-primary">This question</div><div className="mt-2 text-xs leading-5 text-muted-foreground">Question {assessmentIndex + 1} of {assessmentTotal}{assessmentProgress?.domain_id ? ` · ${findDomain(assessmentProgress.domain_id)?.label ?? assessmentProgress.domain_id} · ${topicLabel(assessmentProgress.domain_id, assessmentProgress.topic_id)}` : ''}{assessmentProgress?.subtopic ? ` · ${assessmentProgress.subtopic}` : ''}</div><div className="mt-2 text-sm font-semibold">Difficulty {assessmentMeta.calibrated_difficulty.score}/5 <span className="font-normal text-muted-foreground">· {assessmentQuestion.type.replaceAll('_', ' ')}</span></div></div><div className="min-w-0"><div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Source & impact cap</div><div className="mt-2 text-sm font-semibold">AI-generated, checked by the server</div><p className="mt-1 text-[11px] leading-4 text-muted-foreground">Each question moves this topic&apos;s score by at most ±{assessmentMeta.mastery_impact_cap.max_score_delta} (level changes at most {assessmentMeta.mastery_impact_cap.max_level_band_delta} band).</p></div></div>}
      {mode === 'assessment' && onRestartAssessment && <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-border/70 bg-muted/40 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold">You resumed an unfinished assessment.</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Questions you already answered stay graded. You can also discard this one and begin a new assessment.</p></div><Button onClick={() => setConfirmRestart(true)} disabled={restarting} variant="outline" className="min-h-10 shrink-0 rounded-xl"><span>{restarting ? 'Starting…' : 'Start a new assessment instead'}</span></Button></div>}
      <AlertDialog open={confirmRestart} onOpenChange={setConfirmRestart}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Start a new assessment instead?</AlertDialogTitle><AlertDialogDescription>This closes the assessment you resumed and writes new questions for the same topic scope. The questions you have not answered are dropped from view. Answers already graded keep counting toward your mastery. Writing the first question can take a minute.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => onRestartAssessment?.()}>Start new assessment</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      {mode === 'assessment' && missingSlots.length > 0 && <div role="alert" className="mb-5 flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div><div className="font-semibold">{generatedCount} of {assessmentTotal} questions generated. This assessment is incomplete.</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{missingSlots.map((entry) => `Question ${entry.slot + 1}: ${entry.reason}`).join(' · ')} You can keep answering the questions that are ready.</p></div></div><Button onClick={onRetryMissing} disabled={retrying || !onRetryMissing} variant="outline" className="min-h-10 shrink-0 rounded-xl"><span>{retrying ? 'Retrying…' : 'Retry'}</span></Button></div>}
      <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm"><div className="grid lg:grid-cols-[minmax(19rem,0.76fr)_minmax(0,1.24fr)]">{mode === 'practice' && <BriefPane activity={activity} hints={hints} onRevealHint={onRevealHint} activeFile={activeFile} onOpenFile={(path) => { setActiveFile(path); setTab('editor') }} />}{mode === 'assessment' && <section className="hidden border-r border-border/70 bg-card p-7 lg:block"><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Assessment blueprint</div><h2 className="mt-4 font-serif text-2xl tracking-tight">Evidence over recall.</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">This {assessmentMeta.mode.replaceAll('_', ' ')} uses a validated question variant. Answer with your best reasoning; feedback arrives after submission.</p><div className="mt-7 space-y-4">{assessmentMeta.answer_rules.type !== 'none' && <div className="rounded-2xl bg-muted/60 p-4"><div className="text-sm font-semibold">Answer rules</div><p className="mt-2 text-xs leading-5 text-muted-foreground">{assessmentMeta.answer_rules.type.replaceAll('_', ' ')} · {assessmentMeta.answer_rules.partial_credit}</p></div>}<div className="rounded-2xl border border-primary/20 bg-primary/[0.045] p-4 text-sm leading-6 text-muted-foreground"><CircleHelp className="mb-2 h-4 w-4 text-primary" />Do not overfit to a single question. The coach combines independent evidence and caps one assessment&apos;s mastery impact.</div></div></section>}{mode === 'practice' ? <section className="flex min-w-0 flex-col bg-slate-950"><Tabs value={tab} onValueChange={setTab} className="flex min-h-[42rem] min-w-0 flex-1 flex-col"><TabsList className="h-auto justify-start gap-0 overflow-x-auto rounded-none border-b border-white/10 bg-slate-950 p-0"><TabsTrigger value="editor" className="min-h-12 shrink-0 rounded-none border-b-2 border-transparent px-4 text-slate-400 data-[state=active]:border-primary data-[state=active]:text-white">Editor</TabsTrigger><TabsTrigger value="terminal" className="min-h-12 shrink-0 rounded-none border-b-2 border-transparent px-4 text-slate-400 data-[state=active]:border-primary data-[state=active]:text-white">Tests</TabsTrigger><TabsTrigger value="claude" className="min-h-12 shrink-0 rounded-none border-b-2 border-transparent px-4 text-slate-400 data-[state=active]:border-primary data-[state=active]:text-white">{ai.label}</TabsTrigger><TabsTrigger value="notes" className="min-h-12 shrink-0 rounded-none border-b-2 border-transparent px-4 text-slate-400 data-[state=active]:border-primary data-[state=active]:text-white">Notes</TabsTrigger></TabsList><TabsContent value="editor" className="m-0 flex min-h-0 flex-1 flex-col"><EditorPane activity={activity} value={answerText} onChange={onChangeAnswer} activeFile={activeFile} onSelectFile={setActiveFile} /></TabsContent><TabsContent value="terminal" className="m-0 min-h-0 flex-1"><TerminalPane statusMessage={statusMessage} claude={claude} /></TabsContent><TabsContent value="claude" className="m-0 min-h-0 flex-1"><ClaudePane claude={claude} onStart={onStartClaude} onCancel={onCancelClaude} /></TabsContent><TabsContent value="notes" className="m-0 min-h-0 flex-1 bg-slate-950 p-4"><Textarea value={justification} onChange={(event) => onChangeJustification(event.target.value)} className="min-h-[20rem] resize-y border-white/10 bg-white/5 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus-visible:ring-primary" placeholder="Capture a hypothesis, a tradeoff, or a question for review…" /></TabsContent></Tabs><div className="flex flex-col gap-3 border-t border-white/10 bg-slate-950 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 font-mono text-[10px] text-slate-400"><span className="h-2 w-2 rounded-full bg-emerald-400" />{mode === 'practice' ? 'Ready for isolated execution' : 'Assessment responses stay private until submission'}</div><div className="flex flex-wrap gap-2"><Button onClick={onRun} disabled={loading || !answerText.trim()} variant="outline" className="min-h-10 gap-2 rounded-xl border-white/15 text-slate-100 hover:bg-white/10 active:scale-[0.98] transition-transform"><Play className="h-4 w-4" /><span>{loading ? 'Running…' : 'Run tests'}</span></Button><Button onClick={onSubmit} disabled={loading || !answerText.trim()} className="min-h-10 gap-2 rounded-xl active:scale-[0.98] transition-transform"><Send className="h-4 w-4" /><span>{loading ? 'Submitting…' : 'Submit solution'}</span></Button></div></div></section> : <section className="min-w-0"><AssessmentPane question={assessmentQuestion} answerText={answerText} justification={justification} confidence={confidence} selectedAnswers={selectedAnswers} onChangeAnswer={onChangeAnswer} onChangeJustification={onChangeJustification} onChangeConfidence={onChangeConfidence} onToggleAnswer={onToggleAnswer} /><div className="flex flex-col gap-3 border-t border-border/70 bg-card p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-4 w-4 text-amber-600" />Correctness is shown only after you submit or save an answer.</div><div className="flex flex-wrap gap-2"><Button onClick={onNextAssessment} disabled={loading || (!answerText.trim() && selectedAnswers.length === 0)} variant="outline" className="min-h-10 rounded-xl">{assessmentIndex + 1 < assessmentTotal ? 'Save & next' : 'Finish assessment'}</Button><Button onClick={onSubmit} disabled={loading || (!answerText.trim() && selectedAnswers.length === 0)} className="min-h-10 gap-2 rounded-xl active:scale-[0.98] transition-transform"><Send className="h-4 w-4" /><span>{loading ? 'Submitting…' : 'Submit assessment'}</span></Button></div></div></section>}</div></div></div>
}
