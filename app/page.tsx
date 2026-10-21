'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  CircleUserRound,
  Clock3,
  Code2,
  Compass,
  FileClock,
  Flame,
  History as HistoryIcon,
  Home as HomeIcon,
  Info,
  LayoutDashboard,
  Loader2,
  Menu,
  Moon,
  Network,
  PanelLeft,
  Play,
  Save,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Target,
  TerminalSquare,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  AuthProvider,
  LoginForm,
  ProtectedRoute,
  RegisterForm,
  UserMenu,
  useAuth,
} from 'lyzr-architect-pg/client'
import { Toaster, toast } from 'sonner'
import HomeSection, { type HomeAttempt, type HomeDomain, type HomeRecommendation } from '@/app/sections/home-section'
import PracticeSection, { type AssessmentQuestion, type PracticeActivity } from '@/app/sections/practice-section'
import LessonSection, { type TransferResult } from '@/app/sections/lesson-section'
import ResultSection, { type ReviewData } from '@/app/sections/result-section'
import SkillMapSection, { type SkillDomain, type SkillTopic } from '@/app/sections/skill-map-section'
import { DOMAIN_TOPIC_OPTIONS, topicLabel } from '@/lib/learning-topics'
import { DOMAINS, findDomain, findTopic } from '@/lib/taxonomy'
import { HttpError, withRetry } from '@/lib/retry'

const CLAUDE_RUNTIME = 'claude-cli-oauth'

type ViewName = 'home' | 'practice' | 'assessment' | 'review' | 'lesson' | 'skill-map' | 'history' | 'profile'
type JsonRecord = Record<string, unknown>

type SavedState = {
  profile: JsonRecord | null
  mastery: JsonRecord[]
  activities: JsonRecord[]
  attempts: JsonRecord[]
  recommendations: JsonRecord[]
  assessmentSessions: JsonRecord[]
  assessmentItems: JsonRecord[]
  responses: JsonRecord[]
}

type ClaudeState = {
  available: boolean
  status: string
  notice: string
  job_id: string | null
  exit_code: number | null
  stdout: string
  stderr: string
  changed_files: { path: string; change: string }[]
}

const SAMPLE_ACTIVITY: PracticeActivity = {
  id: 'sample-parser-debug-01',
  domain_id: 'c',
  topic_id: 'pointers-and-bounds',
  domain: 'C',
  topic: 'Repair a corrupted packet parser',
  pack_version: 'v1.0.0',
  level_band: 'Intermediate',
  format: 'debug_code',
  prerequisites: ['c/types-and-control-flow', 'networking/packet-diagnosis'],
  estimated_duration_minutes: 25,
  learning_objectives: ['Validate a fixed header before reading fields.', 'Compare a declared payload length with bytes remaining after the header.', 'Explain why zero-length payloads are valid.'],
  prompt: 'A sensor gateway intermittently crashes while parsing UDP packets. Repair the parser without changing the wire format, and explain the validation order you chose.',
  constraints: ['Reject truncated headers safely.', 'Do not allocate heap memory.', 'Preserve valid zero-length payloads.', 'Treat every length field as untrusted input.'],
  starter_files: [
    { path: 'parser.c', content: 'int parse_packet(const uint8_t *buf, size_t len) {\n  /* repair this parser */\n}' },
    { path: 'parser.h', content: 'typedef struct { uint16_t length; } packet_header_t;' },
    { path: 'test_parser.c', content: '/* public and boundary tests */' },
  ],
  execution_profile: { runtime: 'e2b', language: 'C11', allowed_actions: ['compile', 'run public tests', 'address sanitizer'], time_limit_seconds: 12, network: 'disabled' },
  test_plan: [
    { name: 'Public functional tests', purpose: 'Valid packets and ordinary truncation cases.', visibility: 'public' },
    { name: 'Boundary length tests', purpose: 'Header-only, zero payload, and exact-boundary buffers.', visibility: 'hidden' },
    { name: 'AddressSanitizer', purpose: 'Detect out-of-bounds reads without exposing hidden cases.', visibility: 'hidden' },
  ],
  rubric: [
    { criterion: 'Header boundary validation', weight: 3, evidence: 'Proves the complete header exists before dereference.' },
    { criterion: 'Payload boundary validation', weight: 4, evidence: 'Compares payload length to remaining bytes.' },
    { criterion: 'Reasoning and safety', weight: 3, evidence: 'Explains untrusted length handling and safe failure.' },
  ],
}

const EMPTY_ACTIVITY: PracticeActivity = {
  id: null, domain_id: null, topic_id: null, domain: null, topic: null, pack_version: null, level_band: null, format: null, prerequisites: [], estimated_duration_minutes: 15, learning_objectives: [], prompt: null, constraints: [], starter_files: [], execution_profile: { runtime: 'none', language: null, allowed_actions: [], time_limit_seconds: 0, network: 'unavailable' }, test_plan: [], rubric: [],
}

const SAMPLE_HINTS = [
  { stage: 1, label: 'conceptual nudge', content: 'Before reading any header field, prove that the buffer contains the complete header.', revealed: true },
  { stage: 2, label: 'focused clue', content: 'The payload begins after the header. Validate the declared length against len minus the header size.', revealed: false },
  { stage: 3, label: 'pseudocode or command outline', content: 'if len < sizeof(header), reject; remaining = len - sizeof(header); if declared > remaining, reject.', revealed: false },
  { stage: 4, label: 'explained solution', content: 'Dereference only after the header check, then validate the payload against the remaining bytes. A zero-length payload is safe when the header is complete.', revealed: false },
]

const SAMPLE_DOMAINS: HomeDomain[] = [
  { id: 'c', label: 'C', score: 64, level: 'Intermediate', confidence: 0.78, focus: 'Bounds validation and memory safety', isReal: false },
  { id: 'cpp', label: 'C++', score: 43, level: 'Foundation', confidence: 0.68, focus: 'RAII and object lifetime', isReal: false },
  { id: 'linux', label: 'Linux', score: 71, level: 'Advanced', confidence: 0.81, focus: 'Processes, signals, and debugging', isReal: false },
  { id: 'networking', label: 'Networking', score: 51, level: 'Intermediate', confidence: 0.73, focus: 'Packet diagnosis and sockets', isReal: false },
  { id: 'bsp', label: 'BSP', score: 28, level: 'Basic', confidence: 0.47, focus: 'Boot flow and device trees', isReal: false },
]

const SAMPLE_ATTEMPTS: HomeAttempt[] = [
  { id: 'sample-tcp', title: 'Trace a failed TCP handshake', meta: 'Networking · Scenario', status: 'Passed', duration: '18 min', isReal: false },
  { id: 'sample-raii', title: 'Review unsafe ownership', meta: 'C++ · Code review', status: 'Retry', duration: '22 min', isReal: false },
  { id: 'sample-boot', title: 'Read a bootloader handoff trace', meta: 'BSP · Log analysis', status: 'Passed', duration: '14 min', isReal: false },
]

const SAMPLE_RECOMMENDATION: HomeRecommendation = {
  title: 'Repair a corrupted packet parser',
  description: 'Find and fix three memory-safety defects in a C parser handling variable-length network frames.',
  domain: 'C', topic: 'Pointers & bounds', level: 'Intermediate', format: 'Debugging', duration: 25,
  rationale: 'Your last two attempts showed strong pointer arithmetic but inconsistent bounds validation.', isReal: false,
}

const SAMPLE_QUESTIONS: AssessmentQuestion[] = [
  { stem: 'Before reading a length field from an untrusted packet buffer, what must be proven first?', options: ['The complete fixed header fits in the buffer', 'The payload has a non-zero length', 'The buffer can be copied to the heap'], type: 'single_answer' },
  { stem: 'Which signals can be used to request a process to reload configuration without terminating it?', options: ['SIGHUP', 'SIGTERM', 'SIGKILL', 'SIGUSR1'], type: 'multiple_answer' },
  { stem: 'A TCP client retransmits after a timeout. Which evidence would best distinguish a routing issue from application slowness?', options: ['Packet capture with SYN/SYN-ACK timing', 'The client variable names', 'A larger receive buffer alone'], type: 'single_answer', artifact: 'client → SYN → gateway → ? → server' },
  { stem: 'A device-tree node names a UART but the boot log shows no mapped register range. What is the most useful next check?', options: ['Compare reg and address-cells against the SoC memory map', 'Increase the baud rate immediately', 'Disable all interrupts'], type: 'single_answer' },
  { stem: 'Which evidence is sufficient to claim a generated embedded fix is safe for production hardware?', options: ['A passing local unit test', 'Human review plus hardware-specific validation', 'A confident explanation from the coach'], type: 'single_answer' },
]

const SAMPLE_CLAUDE: ClaudeState = {
  available: true,
  status: 'ready',
  notice: 'Claude CLI runs on the Linux host with its existing OAuth session. No Lyzr API is used for tutoring requests.',
  job_id: null,
  exit_code: null,
  stdout: '',
  stderr: '',
  changed_files: [],
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function hasOwn(value: JsonRecord, key: string) { return Object.prototype.hasOwnProperty.call(value, key) }
function stringValue(value: unknown, fallback = '') { return typeof value === 'string' ? value : fallback }
function nullableString(value: unknown) { return typeof value === 'string' || value === null ? value : null }
// Real header stats: consecutive local days (ending today or yesterday) with a graded response or attempt, and the total of both.
function activityStats(saved: SavedState) {
  const records = [...saved.responses, ...saved.attempts]
  const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
  const days = new Set(records.map((record) => new Date(stringValue(record.created_at))).filter((date) => !Number.isNaN(date.getTime())).map(dayKey))
  const cursor = new Date()
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (days.has(dayKey(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1) }
  return { streak, exercises: records.length }
}

function numberValue(value: unknown, fallback = 0) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
function nullableNumber(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : value === null ? null : null }
function recordValue(value: unknown): JsonRecord { return isRecord(value) ? value : {} }
function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function displayNameFromUser(user: unknown) { const record = recordValue(user); const name = stringValue(record.name); return name || stringValue(record.email).split('@')[0] || 'Learner' }
function displayEmailFromUser(user: unknown) { return stringValue(recordValue(user).email, 'Account email unavailable') }
function clampScore(value: number) { return Math.max(0, Math.min(100, value)) }
function labelize(value: string) { return value.replaceAll('_', ' ') }

function normalizeActivity(raw: unknown): PracticeActivity | null {
  if (!isRecord(raw)) return null
  const execution = recordValue(raw.execution_profile)
  return {
    id: nullableString(raw.id), domain_id: nullableString(raw.domain_id), topic_id: nullableString(raw.topic_id), domain: nullableString(raw.domain), topic: nullableString(raw.topic), pack_version: nullableString(raw.pack_version), level_band: nullableString(raw.level_band), format: nullableString(raw.format),
    prerequisites: arrayValue(raw.prerequisites).filter((value): value is string => typeof value === 'string'), estimated_duration_minutes: numberValue(raw.estimated_duration_minutes, 15), learning_objectives: arrayValue(raw.learning_objectives).filter((value): value is string => typeof value === 'string'), prompt: nullableString(raw.prompt), constraints: arrayValue(raw.constraints).filter((value): value is string => typeof value === 'string'),
    starter_files: arrayValue(raw.starter_files).filter(isRecord).map((file) => ({ path: stringValue(file.path, 'starter-file'), content: stringValue(file.content) })),
    execution_profile: { runtime: stringValue(execution.runtime, 'none'), language: nullableString(execution.language), allowed_actions: arrayValue(execution.allowed_actions).filter((value): value is string => typeof value === 'string'), time_limit_seconds: numberValue(execution.time_limit_seconds), network: stringValue(execution.network, 'unavailable') },
    test_plan: arrayValue(raw.test_plan).filter(isRecord).map((test) => ({ name: stringValue(test.name, 'Test'), purpose: stringValue(test.purpose), visibility: stringValue(test.visibility, 'public') })),
    rubric: arrayValue(raw.rubric).filter(isRecord).map((criterion) => ({ criterion: stringValue(criterion.criterion, 'Criterion'), weight: numberValue(criterion.weight), evidence: stringValue(criterion.evidence) })),
  }
}

function normalizeQuestion(raw: unknown): AssessmentQuestion | null {
  if (!isRecord(raw)) return null
  const generated = recordValue(raw.generated_question)
  const options = arrayValue(generated.options).filter((value): value is string => typeof value === 'string')
  const stem = stringValue(generated.stem)
  if (!stem || options.length === 0) return null
  return { stem, options, type: stringValue(generated.type, 'single_answer'), artifact: nullableString(generated.artifact) }
}

function normalizeCoachResult(raw: unknown, envelopeMetadata?: unknown): ReviewData | null {
  if (!isRecord(raw)) return null
  const required = ['request_type', 'activity', 'feedback', 'hints', 'lecture', 'assessment', 'mastery_evidence', 'recommended_next_activity', 'learner_explanation', 'claude_cli']
  if (!required.every((key) => hasOwn(raw, key))) return null
  const feedbackRaw = recordValue(raw.feedback)
  const activityRaw = recordValue(raw.activity)
  const lectureRaw = recordValue(raw.lecture)
  const assessmentRaw = recordValue(raw.assessment)
  const claudeRaw = recordValue(raw.claude_cli)
  const metadataRaw = isRecord(raw.metadata) ? raw.metadata : recordValue(envelopeMetadata)
  const correctnessRaw = recordValue(feedbackRaw.correctness)
  const reasoningRaw = recordValue(feedbackRaw.reasoning_evaluation)
  const answerRulesRaw = recordValue(assessmentRaw.answer_rules)
  const scoreRaw = recordValue(assessmentRaw.score)
  const capRaw = recordValue(assessmentRaw.mastery_impact_cap)
  const executionRaw = recordValue(activityRaw.execution_profile)
  if (!isRecord(raw.activity) || !isRecord(raw.feedback) || !isRecord(raw.lecture) || !isRecord(raw.assessment) || !isRecord(raw.claude_cli)) return null
  if (!Array.isArray(feedbackRaw.findings) || !Array.isArray(feedbackRaw.public_test_feedback) || !Array.isArray(feedbackRaw.safety_findings) || !Array.isArray(raw.hints) || !Array.isArray(lectureRaw.learning_objectives) || !Array.isArray(lectureRaw.sections) || !Array.isArray(lectureRaw.recap) || !Array.isArray(assessmentRaw.topic_coverage) || !Array.isArray(assessmentRaw.review) || !Array.isArray(raw.mastery_evidence)) return null
  const normalizedActivity = normalizeActivity(activityRaw)
  if (!normalizedActivity) return null
  const findingList = feedbackRaw.findings.filter(isRecord).map((finding) => ({ category: stringValue(finding.category, 'conceptual'), severity: stringValue(finding.severity, 'info'), message: stringValue(finding.message), evidence: stringValue(finding.evidence) }))
  const publicTests = feedbackRaw.public_test_feedback.filter(isRecord).map((test) => ({ name: stringValue(test.name, 'Test'), status: stringValue(test.status, 'skipped'), details: stringValue(test.details) }))
  const hints = raw.hints.filter(isRecord).map((hint) => ({ stage: numberValue(hint.stage), label: stringValue(hint.label), content: stringValue(hint.content), revealed: hint.revealed === true }))
  const lectureSections = lectureRaw.sections.filter(isRecord).map((section) => ({ title: stringValue(section.title, 'Lesson section'), content: stringValue(section.content), example: nullableString(section.example), debugging_method: nullableString(section.debugging_method) }))
  const coverage = assessmentRaw.topic_coverage.filter(isRecord).map((topic) => ({ domain_id: stringValue(topic.domain_id), topic_id: stringValue(topic.topic_id), weight: numberValue(topic.weight) }))
  const review = assessmentRaw.review.filter(isRecord).map((item) => ({ item_id: stringValue(item.item_id), topic_id: stringValue(item.topic_id), valid: item.valid === true, explanation: stringValue(item.explanation), misconception: nullableString(item.misconception) }))
  const mastery = raw.mastery_evidence.filter(isRecord).map((item) => ({ domain_id: stringValue(item.domain_id), topic_id: stringValue(item.topic_id), level_band: stringValue(item.level_band, 'Basic'), score: numberValue(item.score), confidence: numberValue(item.confidence), evidence: arrayValue(item.evidence).filter((line): line is string => typeof line === 'string'), recommended_focus: stringValue(item.recommended_focus) }))
  const changedFiles = arrayValue(claudeRaw.changed_files).filter(isRecord).map((file) => ({ path: stringValue(file.path, 'unknown'), change: stringValue(file.change) }))
  return {
    activity: normalizedActivity, request_type: stringValue(raw.request_type, 'unknown'), activitySummary: stringValue(activityRaw.prompt, 'Activity response'),
    feedback: { summary: stringValue(feedbackRaw.summary), findings: findingList, public_test_feedback: publicTests, hidden_test_summary: nullableString(feedbackRaw.hidden_test_summary), correctness: { score: numberValue(correctnessRaw.score), max_score: numberValue(correctnessRaw.max_score), confidence: numberValue(correctnessRaw.confidence) }, reasoning_evaluation: { score: numberValue(reasoningRaw.score), max_score: numberValue(reasoningRaw.max_score), summary: stringValue(reasoningRaw.summary) }, safety_findings: feedbackRaw.safety_findings.filter((line): line is string => typeof line === 'string') },
    hints, lecture: { selected_depth: stringValue(lectureRaw.selected_depth, 'none'), estimated_duration_minutes: numberValue(lectureRaw.estimated_duration_minutes), selection_reason: stringValue(lectureRaw.selection_reason), learning_objectives: lectureRaw.learning_objectives.filter((line): line is string => typeof line === 'string'), sections: lectureSections, common_failure_mode: nullableString(lectureRaw.common_failure_mode), recap: lectureRaw.recap.filter((line): line is string => typeof line === 'string'), retrieval_check: { prompt: nullableString(recordValue(lectureRaw.retrieval_check).prompt), answer_rule: nullableString(recordValue(lectureRaw.retrieval_check).answer_rule) }, transfer_exercise: { prompt: nullableString(recordValue(lectureRaw.transfer_exercise).prompt), format: nullableString(recordValue(lectureRaw.transfer_exercise).format) } },
    assessment: { mode: stringValue(assessmentRaw.mode, 'none'), blueprint_id: nullableString(assessmentRaw.blueprint_id), blueprint_version: nullableString(assessmentRaw.blueprint_version), topic_coverage: coverage, calibrated_difficulty: { score: numberValue(recordValue(assessmentRaw.calibrated_difficulty).score), factors: arrayValue(recordValue(assessmentRaw.calibrated_difficulty).factors).filter((line): line is string => typeof line === 'string') }, validation_state: stringValue(assessmentRaw.validation_state, 'none'), answer_rules: { type: stringValue(answerRulesRaw.type, 'none'), partial_credit: stringValue(answerRulesRaw.partial_credit) }, score: { earned: numberValue(scoreRaw.earned), possible: numberValue(scoreRaw.possible), confidence: numberValue(scoreRaw.confidence) }, mastery_impact_cap: { max_level_band_delta: numberValue(capRaw.max_level_band_delta), max_score_delta: numberValue(capRaw.max_score_delta) }, review },
    mastery_evidence: mastery, recommended_next_activity: (() => { const next = recordValue(raw.recommended_next_activity); return { domain_id: nullableString(next.domain_id), topic_id: nullableString(next.topic_id), format: nullableString(next.format), level_band: nullableString(next.level_band), reason: stringValue(next.reason), estimated_duration_minutes: numberValue(next.estimated_duration_minutes) } })(), learner_explanation: stringValue(raw.learner_explanation), claude_cli: { available: claudeRaw.available === true, status: stringValue(claudeRaw.status, 'unavailable'), notice: stringValue(claudeRaw.notice), job_id: nullableString(claudeRaw.job_id), exit_code: nullableNumber(claudeRaw.exit_code), stdout: stringValue(claudeRaw.stdout), stderr: stringValue(claudeRaw.stderr), changed_files: changedFiles }, metadata: { agent_name: stringValue(metadataRaw.agent_name, 'Embedded Systems Learning Coach'), timestamp: stringValue(metadataRaw.timestamp), request_id: nullableString(metadataRaw.request_id) },
  }
}

function fallbackClaudeFromReview(review: ReviewData): ClaudeState { return review.claude_cli }

const itemSlot = (item: JsonRecord) => numberValue(recordValue(item.generated_question).slot, -1)
const insertBySlot = (items: JsonRecord[], item: JsonRecord) => (items.some((existing) => itemSlot(existing) === itemSlot(item)) ? items : [...items, item].sort((a, b) => itemSlot(a) - itemSlot(b)))
// Next question after `slot`: skips slots that failed (missing), 'wait' while the following slot is still being written, null when nothing is left to show.
function nextAvailable(gen: { total: number; items: JsonRecord[]; missing: { slot: number }[] }, slot: number): JsonRecord | 'wait' | null {
  for (let next = slot + 1; next < gen.total; next++) {
    const item = gen.items.find((candidate) => itemSlot(candidate) === next)
    if (item) return item
    if (!gen.missing.some((entry) => entry.slot === next)) return 'wait'
  }
  return null
}

const concealHints = (list: typeof SAMPLE_HINTS) => list.map((hint) => ({ ...hint, revealed: false }))

type LessonState = { domainId: string; topicId: string; status: 'loading' | 'ready' | 'error'; error: string | null; variant: string | null; practice: 'loading' | 'ready' | 'error'; busy: boolean }
const LESSON_VARIANTS: Record<string, string> = { shorter: 'Shorter version', 'another-example': 'Another example', prerequisites: 'Prerequisites refresher', adapt: 'Adapted to your questions' }

// A topic_mastery row written by "Mark learned" has evidence_summary.state 'learned'; the grade route overwrites it with 'assessed'.
const isLearnedRow = (item: JsonRecord) => recordValue(item.evidence_summary).state === 'learned'
// Home "Recommended next" for real data: assess the latest learned-but-unassessed topic, otherwise the next untouched topic in taxonomy order after the latest activity.
function pickRecommendation(mastery: JsonRecord[]): HomeRecommendation | null {
  if (mastery.length === 0) return null
  const touched = new Set(mastery.map((item) => `${stringValue(item.domain_id)}/${stringValue(item.topic_id)}`))
  const latest = (rows: JsonRecord[]) => rows.reduce<JsonRecord | undefined>((best, item) => (!best || stringValue(item.updated_at) > stringValue(best.updated_at) ? item : best), undefined)
  const learned = latest(mastery.filter(isLearnedRow))
  if (learned) {
    const domain = findDomain(stringValue(learned.domain_id)); const topic = findTopic(stringValue(learned.domain_id), stringValue(learned.topic_id))
    if (domain && topic) return { title: `Assess ${topic.label}`, description: `You marked ${topic.label} as learned. A short topic assessment turns it into a rating on your skill map.`, domain: domain.label, topic: topic.label, level: 'Not rated', format: 'Assessment', duration: 5, rationale: 'Learned, but not assessed yet.', isReal: true, action: { kind: 'assess', domainId: domain.id, topicId: topic.id, label: 'Assess this topic' } }
  }
  const last = latest(mastery)
  const lastDomain = last ? findDomain(stringValue(last.domain_id)) : undefined
  const lastIndex = lastDomain?.topics.findIndex((topic) => topic.id === stringValue(last?.topic_id)) ?? -1
  const afterLast = lastDomain?.topics.slice(lastIndex + 1).find((topic) => !touched.has(`${lastDomain.id}/${topic.id}`))
  const next = afterLast && lastDomain ? { domain: lastDomain, topic: afterLast } : DOMAINS.flatMap((domain) => domain.topics.map((topic) => ({ domain, topic }))).find(({ domain, topic }) => !touched.has(`${domain.id}/${topic.id}`))
  if (!next) return null
  return { title: `Learn ${next.topic.label}`, description: `Next topic in ${next.domain.label}: ${next.topic.subtopics.slice(0, 2).join('; ')}.`, domain: next.domain.label, topic: next.topic.label, level: 'Basic', format: 'Lesson', duration: 15, rationale: 'The next topic in taxonomy order that has no lesson or assessment yet.', isReal: true, action: { kind: 'learn', domainId: next.domain.id, topicId: next.topic.id, label: 'Start lesson' } }
}

function AuthScreen() {
  const [loginMode, setLoginMode] = useState(true)
  return <main className="min-h-screen bg-background p-4 text-foreground sm:p-8"><div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-6xl overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm lg:grid-cols-[1.1fr_0.9fr]"><section className="flex flex-col justify-between bg-muted/40 p-7 sm:p-12"><div><div className="flex items-center gap-3 text-sm font-semibold"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Code2 className="h-4 w-4" /></span><span><span className="text-primary">Embed</span>Path</span></div><div className="mt-20 max-w-xl lg:mt-28"><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Practice-first coaching</div><h1 className="mt-4 font-serif text-4xl tracking-tight text-balance sm:text-6xl">Know what to practice next.</h1><p className="mt-5 max-w-lg text-pretty text-base leading-7 text-muted-foreground">An adaptive workspace for C, C++, Linux, Networking, and BSP. Build mastery from evidence, not generic course progress.</p><div className="mt-8 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-border/70 bg-background/70 p-4"><BrainCircuit className="h-5 w-5 text-primary" /><div className="mt-5 text-sm font-semibold">Independent tracks</div><p className="mt-1 text-xs leading-5 text-muted-foreground">One level per domain and topic.</p></div><div className="rounded-2xl border border-border/70 bg-background/70 p-4"><TerminalSquare className="h-5 w-5 text-primary" /><div className="mt-5 text-sm font-semibold">Concrete feedback</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Tests, reasoning, and safety.</p></div><div className="rounded-2xl border border-border/70 bg-background/70 p-4"><Sparkles className="h-5 w-5 text-primary" /><div className="mt-5 text-sm font-semibold">Adaptive loop</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Practice, learn, retry, transfer.</p></div></div></div></div><div className="mt-12 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 text-primary" />Sandboxed tasks never claim production hardware safety without human review.</div></section><section className="flex items-center justify-center p-6 sm:p-12"><div className="w-full max-w-sm"><div className="mb-8"><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{loginMode ? 'Welcome back' : 'Create your learning desk'}</div><h2 className="mt-3 font-serif text-3xl tracking-tight">{loginMode ? 'Continue your practice.' : 'Start with evidence.'}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{loginMode ? 'Sign in to resume your saved attempts and skill map.' : 'Your first session begins with a mixed diagnostic across five domains.'}</p></div>{loginMode ? <LoginForm onSwitchToRegister={() => setLoginMode(false)} /> : <RegisterForm onSwitchToLogin={() => setLoginMode(true)} />}</div></section></div></main>
}

function SideNavigation({ view, onNavigate, displayName }: { view: ViewName; onNavigate: (view: ViewName) => void; displayName: string }) {
  const items: { id: ViewName; label: string; icon: LucideIcon }[] = [
    { id: 'home', label: 'Home', icon: HomeIcon }, { id: 'skill-map', label: 'Skill Map', icon: Compass }, { id: 'history', label: 'History', icon: HistoryIcon }, { id: 'profile', label: 'Profile', icon: Settings },
  ]
  return <aside className="hidden w-64 shrink-0 border-r border-border/70 bg-muted/25 lg:flex lg:min-h-screen lg:flex-col lg:sticky lg:top-0"><div className="flex items-center gap-3 px-6 py-7 text-sm font-semibold"><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Code2 className="h-4 w-4" /></span><span><span className="text-primary">Embed</span>Path</span></div><nav className="space-y-1 px-3" aria-label="Primary navigation">{items.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => onNavigate(item.id)} className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === item.id ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:bg-card/70 hover:text-foreground'}`}><Icon className="h-4 w-4" />{item.label}</button> })}</nav><div className="mt-auto border-t border-border/70 p-5"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary"><UserRound className="h-4 w-4" /></span><div className="min-w-0"><div className="truncate text-sm font-semibold">{displayName}</div><div className="text-xs text-muted-foreground">Adaptive track</div></div></div></div></aside>
}

function MobileNavigation({ view, onNavigate }: { view: ViewName; onNavigate: (view: ViewName) => void }) {
  const items: { id: ViewName; label: string; icon: LucideIcon }[] = [{ id: 'home', label: 'Home', icon: HomeIcon }, { id: 'skill-map', label: 'Map', icon: Compass }, { id: 'history', label: 'History', icon: HistoryIcon }, { id: 'profile', label: 'Profile', icon: Settings }]
  return <div className="overflow-x-auto border-b border-border/70 bg-background px-3 py-2 lg:hidden"><nav className="mx-auto flex min-w-max max-w-6xl gap-1" aria-label="Mobile navigation">{items.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => onNavigate(item.id)} className={`flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === item.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><Icon className="h-3.5 w-3.5" />{item.label}</button> })}</nav></div>
}

function HeaderBar({ view, displayName, theme, onToggleTheme, sampleData, onToggleSampleData, activeAgentId, streak, exercises, onNavigate }: { view: ViewName; displayName: string; theme: 'light' | 'dark'; onToggleTheme: () => void; sampleData: boolean; onToggleSampleData: (checked: boolean) => void; activeAgentId: string | null; streak: number; exercises: number; onNavigate: (view: ViewName) => void }) {
  const pageTitle = view === 'home' ? 'Learning desk' : view === 'practice' ? 'Practice workspace' : view === 'assessment' ? 'Assessment workspace' : view === 'review' ? 'Attempt review' : view === 'lesson' ? 'Lesson' : view === 'skill-map' ? 'Your skill map' : view === 'history' ? 'Practice history' : 'Profile & preferences'
  return <header className="border-b border-border/70 bg-background/90 px-4 py-4 backdrop-blur sm:px-6 lg:px-8"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><div className="lg:hidden"><Button onClick={() => onNavigate('home')} variant="ghost" size="icon" className="h-10 w-10 rounded-xl"><PanelLeft className="h-4 w-4" /></Button></div><div className="min-w-0"><div className="truncate text-sm font-semibold">{pageTitle}</div><div className="hidden truncate text-xs text-muted-foreground sm:block">Practice-first learning for embedded systems</div></div></div><div className="flex flex-wrap items-center justify-end gap-2">{streak > 0 && <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-2 text-xs sm:flex"><Flame className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /><span className="font-semibold">{streak} day streak</span></div>}{exercises > 0 && <div className="hidden items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-2 text-xs md:flex"><Activity className="h-3.5 w-3.5 text-primary" /><span>{exercises} {exercises === 1 ? 'exercise' : 'exercises'}</span></div>}<div className="flex items-center gap-2 rounded-full border border-border/70 bg-card px-2 py-1.5"><Switch id="sample-data" checked={sampleData} onCheckedChange={onToggleSampleData} /><label htmlFor="sample-data" className="pr-1 text-xs font-medium">Sample Data</label></div><Button onClick={onToggleTheme} variant="outline" size="icon" className="h-10 w-10 rounded-xl" aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}>{theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button><div className="flex items-center gap-2 rounded-full border border-border/70 bg-card py-1 pl-2 pr-1"><span className={`h-2 w-2 rounded-full ${activeAgentId ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'}`} /><span className="hidden text-[11px] text-muted-foreground xl:inline" title="Runs the adaptive tutor directly through Claude CLI on the Linux host OAuth session.">{activeAgentId ? 'Claude CLI working' : 'Claude CLI · OAuth'}</span><UserMenu /></div></div></div></header>
}

function HistoryPanel({ attempts, sampleData, onBack, onPractice }: { attempts: HomeAttempt[]; sampleData: boolean; onBack: () => void; onPractice: () => void }) {
  return <div className="mx-auto w-full max-w-5xl space-y-7 pb-10"><div className="flex flex-col gap-4 border-b border-border/70 pb-7 sm:flex-row sm:items-end sm:justify-between"><div><button onClick={onBack} className="mb-3 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowRight className="h-4 w-4 rotate-180" />Back to home</button><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Evidence trail</div><h1 className="mt-3 font-serif text-4xl tracking-tight">Your practice history.</h1><p className="mt-3 max-w-2xl text-pretty leading-7 text-muted-foreground">Review what you attempted, where feedback landed, and which practice loop is next.</p></div><Button onClick={onPractice} className="min-h-11 gap-2 rounded-xl"><Play className="h-4 w-4" />Open practice</Button></div>{sampleData && <div className="rounded-2xl border border-primary/20 bg-primary/[0.045] px-4 py-3 text-sm text-muted-foreground"><span className="font-semibold text-foreground">Example history.</span> Turn off Sample Data to see only saved attempts.</div>}<Card className="rounded-3xl border-border/70 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><FileClock className="h-5 w-5 text-primary" />Recent attempts</CardTitle></CardHeader><CardContent>{attempts.length > 0 ? <div className="divide-y divide-border/70">{attempts.map((attempt) => <div key={attempt.id} className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${attempt.status === 'Passed' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}><CheckCircle2 className="h-4 w-4" /></span><div><div className="font-medium">{attempt.title}</div><div className="mt-1 text-xs text-muted-foreground">{attempt.meta}{!attempt.isReal && ' · example'}</div></div></div><div className="flex items-center gap-6 pl-12 text-sm sm:pl-0"><span className={attempt.status === 'Passed' ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-amber-700 dark:text-amber-400'}>{attempt.status}</span><span className="font-mono text-xs text-muted-foreground">{attempt.duration}</span></div></div>)}</div> : <div className="rounded-2xl bg-muted/60 p-6 text-sm text-muted-foreground">No saved attempts yet. Start the diagnostic or open a practice workspace to create your first evidence.</div>}</CardContent></Card></div>
}

function ProfilePanel({ displayName, email, profile, sampleData, onBack, onToggleSampleData }: { displayName: string; email: string; profile: JsonRecord | null; sampleData: boolean; onBack: () => void; onToggleSampleData: (checked: boolean) => void }) {
  const preferences = recordValue(profile?.preferences)
  const onboarding = recordValue(profile?.onboarding_state)
  return <div className="mx-auto w-full max-w-4xl space-y-7 pb-10"><div className="border-b border-border/70 pb-7"><button onClick={onBack} className="mb-3 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowRight className="h-4 w-4 rotate-180" />Back to home</button><div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Learning desk settings</div><h1 className="mt-3 font-serif text-4xl tracking-tight">Your profile.</h1><p className="mt-3 max-w-2xl leading-7 text-muted-foreground">Keep your preferences close to the practice loop. Account access is handled by EmbedPath authentication.</p></div><div className="grid gap-6 md:grid-cols-[1.1fr_0.9fr]"><Card className="rounded-3xl border-border/70 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><CircleUserRound className="h-5 w-5 text-primary" />Account</CardTitle></CardHeader><CardContent className="space-y-4"><div className="flex items-center gap-4"><span className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary"><UserRound className="h-6 w-6" /></span><div><div className="text-lg font-semibold">{displayName}</div><div className="text-sm text-muted-foreground">{email}</div></div></div><Separator /><div className="grid gap-3 text-sm"><div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Track</span><span className="font-medium">Embedded systems</span></div><div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Onboarding</span><Badge variant="outline" className="rounded-full">{stringValue(onboarding.status, 'needs diagnostic')}</Badge></div><div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Study length</span><span className="font-medium">{numberValue(preferences.study_minutes, 25)} min</span></div></div></CardContent></Card><Card className="rounded-3xl border-border/70 shadow-sm"><CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5 text-primary" />Workspace preferences</CardTitle></CardHeader><CardContent className="space-y-5"><label className="flex items-start justify-between gap-4 rounded-2xl border border-border/70 p-4"><span><span className="block text-sm font-semibold">Sample Data</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Keep representative exercises visible while you explore.</span></span><Switch checked={sampleData} onCheckedChange={onToggleSampleData} /></label><div className="rounded-2xl bg-muted/60 p-4 text-sm leading-6 text-muted-foreground"><div className="flex items-center gap-2 font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-primary" />Data boundaries</div><p className="mt-2">Saved progress stays scoped to this account. Theme is the only browser preference; learning records use PostgreSQL.</p></div><div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm leading-6 text-muted-foreground"><div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300"><Info className="h-4 w-4" />Claude CLI runtime</div><p className="mt-2">Tutor requests run directly through Claude CLI using the Linux host OAuth session. No Lyzr API or OAuth Connect flow is used.</p></div></CardContent></Card></div></div>
}

function EmbedPathApp() {
  const { authFetch, user } = useAuth()
  const [view, setView] = useState<ViewName>('home')
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [sampleData, setSampleData] = useState(true)
  const [dateLabel, setDateLabel] = useState('Your learning desk')
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedState>({ profile: null, mastery: [], activities: [], attempts: [], recommendations: [], assessmentSessions: [], assessmentItems: [], responses: [] })
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)
  const [selectedActivity, setSelectedActivity] = useState<PracticeActivity>(SAMPLE_ACTIVITY)
  const [hints, setHints] = useState(SAMPLE_HINTS)
  const [answerText, setAnswerText] = useState('')
  const [justification, setJustification] = useState('')
  const [confidence, setConfidence] = useState('')
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([])
  const [rawIndex, setRawIndex] = useState(0)
  const [currentSlot, setCurrentSlot] = useState(0)
  const [assessmentScope, setAssessmentScope] = useState<{ domainId: string; topicId: string } | null>(null)
  const [review, setReview] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [claudeState, setClaudeState] = useState<ClaudeState>(SAMPLE_CLAUDE)
  const [generated, setGenerated] = useState<{ sessionId: string; total: number; items: JsonRecord[]; coverage: { domain_id: string; topic_id: string; weight: number; subtopic?: string }[]; pending: number; missing: { slot: number; reason: string }[] } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [lesson, setLesson] = useState<LessonState | null>(null)
  const [lessonData, setLessonData] = useState<ReviewData | null>(null)
  const [practiceLoad, setPracticeLoad] = useState<{ domainId: string; topicId: string; status: 'loading' | 'error'; error: string | null } | null>(null)
  const [markingLearned, setMarkingLearned] = useState(false)
  const [retrievalFeedback, setRetrievalFeedback] = useState<string | null>(null)
  const [transferResult, setTransferResult] = useState<TransferResult | null>(null)
  const [transferStatus, setTransferStatus] = useState<'idle' | 'grading' | 'error'>('idle')
  const [transferError, setTransferError] = useState<string | null>(null)
  const [waitingNext, setWaitingNext] = useState(false)
  // Generated items are kept sorted by slot; the displayed question is tracked by slot so a late or retried question inserted before it never shifts the view.
  const assessmentIndex = generated ? Math.max(0, generated.items.findIndex((item) => itemSlot(item) === currentSlot)) : rawIndex

  useEffect(() => {
    const storedTheme = window.localStorage.getItem('theme')
    if (storedTheme === 'dark' || storedTheme === 'light') setTheme(storedTheme)
    setDateLabel(new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()))
  }, [])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [view])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    window.localStorage.setItem('theme', theme)
  }, [theme])

  const loadSavedData = useCallback(async () => {
    setDataLoading(true)
    setDataError(null)
    try {
      const seedResponse = await authFetch('/api/seed', { method: 'POST' })
      if (!seedResponse.ok) throw new Error('Account seed could not be completed.')
      // Mark stale in_progress sessions abandoned before reading them (best effort; the threshold lives in the route).
      await authFetch('/api/assessment/cleanup', { method: 'POST' }).catch(() => undefined)
      const routes = ['/api/learner_profiles', '/api/topic_mastery', '/api/activities', '/api/attempts', '/api/recommendations', '/api/assessment_sessions', '/api/assessment_items', '/api/assessment_responses']
      const responses = await Promise.all(routes.map((route) => authFetch(route)))
      const payloads = await Promise.all(responses.map(async (response) => {
        const body: unknown = await response.json()
        if (!response.ok || !isRecord(body) || body.success !== true) throw new Error(isRecord(body) ? stringValue(body.error, 'Saved data request failed.') : 'Saved data request failed.')
        return body.data
      }))
      // Abandoned sessions (and their unanswered items) stay in the database but never reach the UI; graded responses still count.
      const assessmentSessions = Array.isArray(payloads[5]) ? payloads[5].filter((session): session is JsonRecord => isRecord(session) && session.status !== 'abandoned') : []
      const abandonedIds = new Set(Array.isArray(payloads[5]) ? payloads[5].filter(isRecord).filter((session) => session.status === 'abandoned').map((session) => stringValue(session.id)) : [])
      const next: SavedState = { profile: Array.isArray(payloads[0]) && isRecord(payloads[0][0]) ? payloads[0][0] : null, mastery: Array.isArray(payloads[1]) ? payloads[1].filter(isRecord) : [], activities: Array.isArray(payloads[2]) ? payloads[2].filter(isRecord) : [], attempts: Array.isArray(payloads[3]) ? payloads[3].filter(isRecord) : [], recommendations: Array.isArray(payloads[4]) ? payloads[4].filter(isRecord) : [], assessmentSessions, assessmentItems: Array.isArray(payloads[6]) ? payloads[6].filter((item): item is JsonRecord => isRecord(item) && !abandonedIds.has(stringValue(item.session_id))) : [], responses: Array.isArray(payloads[7]) ? payloads[7].filter(isRecord) : [] }
      setSaved(next)
      const hasProgress = next.attempts.length > 0 || next.mastery.some((item) => numberValue(item.score) > 0) || (Array.isArray(payloads[7]) && payloads[7].length > 0)
      setSampleData(!hasProgress)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Saved data could not be loaded.'
      setDataError(message)
      toast.error(message)
    } finally {
      setDataLoading(false)
    }
  }, [authFetch])
  useEffect(() => { void loadSavedData() }, [loadSavedData])
  // The grade route persists the response and mastery; re-read mastery and stop showing sample data over it.
  const refreshMastery = useCallback(async () => {
    try {
      const response = await authFetch('/api/topic_mastery')
      const body: unknown = await response.json()
      if (!response.ok || !isRecord(body) || body.success !== true || !Array.isArray(body.data)) throw new Error('Updated mastery could not be loaded.')
      const mastery = body.data.filter(isRecord)
      // Header stats count graded responses, so refresh them too (best effort).
      const responses = await authFetch('/api/assessment_responses').then((res) => res.json()).then((payload: unknown) => isRecord(payload) && Array.isArray(payload.data) ? payload.data.filter(isRecord) : null).catch(() => null)
      setSaved((current) => ({ ...current, mastery, ...(responses && { responses }) }))
      setSampleData(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Updated mastery could not be loaded.')
    }
  }, [authFetch])

  const realActivity = useMemo(() => normalizeActivity(saved.activities[0]), [saved.activities])
  const activeActivity = sampleData ? SAMPLE_ACTIVITY : realActivity ?? EMPTY_ACTIVITY
  const headerStats = useMemo(() => activityStats(saved), [saved])
  const displayName = displayNameFromUser(user)
  const displayEmail = displayEmailFromUser(user)
  const homeAttempts = useMemo<HomeAttempt[]>(() => {
    if (sampleData) return SAMPLE_ATTEMPTS
    return saved.attempts.map((attempt, index) => { const feedback = recordValue(attempt.feedback); return { id: stringValue(attempt.id, `attempt-${index + 1}`), title: stringValue(feedback.title, 'Embedded systems practice'), meta: `${stringValue(feedback.domain, 'Saved attempt')} · ${stringValue(feedback.format, 'Review')}`, status: stringValue(attempt.completion_state, 'Saved') === 'completed' ? 'Passed' : 'Retry', duration: `${Math.max(1, Math.round(numberValue(attempt.hint_count) + 12))} min`, isReal: true } })
  }, [sampleData, saved.attempts])
  const homeRecommendation = useMemo<HomeRecommendation>(() => {
    if (sampleData) return SAMPLE_RECOMMENDATION
    const picked = pickRecommendation(saved.mastery)
    if (picked) return picked
    const record = saved.recommendations[0]
    const metadata = recordValue(record?.activity_metadata)
    return record ? { title: stringValue(metadata.title, 'Continue your diagnostic'), description: stringValue(metadata.description, 'Use the coach to generate the next evidence-building activity.'), domain: stringValue(metadata.domain, 'Embedded systems'), topic: stringValue(metadata.topic, 'Mixed diagnostic'), level: stringValue(metadata.level_band, 'Basic'), format: stringValue(metadata.format, 'Diagnostic'), duration: numberValue(metadata.estimated_duration_minutes, 15), rationale: stringValue(record.rationale, 'The next task is selected from your current evidence.'), isReal: true } : { title: 'Start your mixed diagnostic', description: 'Answer a few varied questions so the coach can build an independent baseline for each domain.', domain: 'All domains', topic: 'Initial placement', level: 'Basic → Expert', format: 'Assessment', duration: 12, rationale: 'No saved recommendation exists yet. A diagnostic creates the evidence needed for an adaptive path.', isReal: false }
  }, [sampleData, saved.recommendations, saved.mastery])
  const assessmentQuestions = useMemo(() => { if (generated) { const fresh = generated.items.map(normalizeQuestion).filter((item): item is AssessmentQuestion => item !== null); if (fresh.length > 0) return fresh } if (sampleData) return SAMPLE_QUESTIONS; const normalized = saved.assessmentItems.map(normalizeQuestion).filter((item): item is AssessmentQuestion => item !== null); return normalized.length > 0 ? normalized : SAMPLE_QUESTIONS.slice(0, 1) }, [generated, sampleData, saved.assessmentItems])
  const assessmentQuestion = assessmentQuestions[Math.min(assessmentIndex, assessmentQuestions.length - 1)] ?? SAMPLE_QUESTIONS[0]
  const assessmentSession = saved.assessmentSessions[0]
  // One entry per unique topic, in slot order: weight = number of questions, subtopics = the angle each slot covers (empty for sessions stored before subtopics were kept).
  const assessmentCoverage = useMemo(() => {
    if (sampleData) return SAMPLE_DOMAINS.map((domain) => ({ domain_id: domain.id, topic_id: domain.focus.toLowerCase().replaceAll(' ', '-'), weight: 1, subtopics: [] as string[] }))
    const raw = generated ? generated.coverage : arrayValue(assessmentSession?.topic_coverage).filter(isRecord).map((item) => ({ domain_id: stringValue(item.domain_id), topic_id: stringValue(item.topic_id), weight: numberValue(item.weight), subtopic: stringValue(item.subtopic) }))
    const merged: { domain_id: string; topic_id: string; weight: number; subtopics: string[] }[] = []
    raw.forEach((item, index) => {
      const subtopic = item.subtopic || stringValue(recordValue(generated?.items.find((entry) => itemSlot(entry) === index)?.generated_question).topic)
      const existing = merged.find((entry) => entry.domain_id === item.domain_id && entry.topic_id === item.topic_id)
      if (existing) { existing.weight += item.weight || 1; if (subtopic) existing.subtopics.push(subtopic) } else merged.push({ domain_id: item.domain_id, topic_id: item.topic_id, weight: item.weight || 1, subtopics: subtopic ? [subtopic] : [] })
    })
    return merged
  }, [generated, sampleData, assessmentSession])
  const assessmentMeta = useMemo(() => { if (generated) { const item = generated.items[Math.min(assessmentIndex, generated.items.length - 1)]; const rules = recordValue(item?.answer_rules); const difficulty = recordValue(item?.difficulty_factors); return { mode: 'knowledge_check', blueprint_id: nullableString(item?.blueprint_id), blueprint_version: nullableString(item?.blueprint_version), calibrated_difficulty: { score: numberValue(difficulty.score, 3), factors: arrayValue(difficulty.factors).filter((line): line is string => typeof line === 'string') }, validation_state: stringValue(recordValue(item?.validation_evidence).state, 'model_generated').replaceAll('_', ' '), answer_rules: { type: stringValue(rules.type, 'single_answer'), partial_credit: stringValue(rules.partial_credit) }, mastery_impact_cap: { max_level_band_delta: 1, max_score_delta: 8 } } } if (sampleData) return { mode: 'knowledge_check', blueprint_id: 'mixed-diagnostic-v1', blueprint_version: 'v1.0.0', calibrated_difficulty: { score: 2, factors: ['prerequisite depth', 'reasoning steps'] }, validation_state: 'valid', answer_rules: { type: 'single_answer', partial_credit: 'Written reasoning contributes confidence, not answer-key credit.' }, mastery_impact_cap: { max_level_band_delta: 1, max_score_delta: 8 } }; const item = saved.assessmentItems[0]; const rules = recordValue(item?.answer_rules); return { mode: stringValue(assessmentSession?.mode, 'knowledge_check'), blueprint_id: nullableString(item?.blueprint_id), blueprint_version: nullableString(item?.blueprint_version), calibrated_difficulty: { score: numberValue(recordValue(item?.difficulty_factors).score, 2), factors: arrayValue(recordValue(item?.difficulty_factors).factors).filter((line): line is string => typeof line === 'string') }, validation_state: stringValue(recordValue(item?.validation_evidence).state, 'pending'), answer_rules: { type: stringValue(rules.type, 'single_answer'), partial_credit: stringValue(rules.partial_credit) }, mastery_impact_cap: { max_level_band_delta: 1, max_score_delta: 8 } } }, [generated, assessmentIndex, sampleData, assessmentSession, saved.assessmentItems])
  const skillDomains = useMemo<SkillDomain[]>(() => {
    if (sampleData) return SAMPLE_DOMAINS.map((domain) => ({ id: domain.id, label: domain.label, level: domain.level, score: domain.score, isReal: false, topics: domain.id === 'c' ? [{ id: 'types-control-flow', label: 'Types & control flow', score: 91, level: 'Advanced', confidence: 0.91, state: 'ready', detail: 'Strong evidence from output prediction and implementation tasks.', evidence: ['Explained integer conversions in two formats.', 'Passed a control-flow repair exercise.'], prerequisite: null, isReal: false }, { id: 'pointers-bounds', label: 'Pointers & bounds', score: 64, level: 'Intermediate', confidence: 0.78, state: 'active', detail: 'Bounds checks are improving; the next exercise targets validation order.', evidence: ['Strong pointer arithmetic in the last attempt.', 'Two recent misses on truncated headers.'], prerequisite: null, isReal: false }, { id: 'memory-lifetime', label: 'Memory & lifetime', score: 55, level: 'Intermediate', confidence: 0.64, state: 'ready', detail: 'Review ownership and allocation tradeoffs before concurrency.', evidence: ['Identified one leak in a code review.'], prerequisite: null, isReal: false }, { id: 'concurrency', label: 'Concurrency', score: 0, level: 'Locked', confidence: 0, state: 'locked', detail: 'Complete memory prerequisites first.', evidence: [], prerequisite: 'Complete memory & lifetime', isReal: false }] : [{ id: `${domain.id}-core`, label: domain.focus, score: domain.score, level: domain.level, confidence: domain.confidence, state: 'active', detail: `Your ${domain.label} track is ready for a focused diagnostic.`, evidence: ['Sample evidence is shown until you complete the mixed diagnostic.'], prerequisite: null, isReal: false }, { id: `${domain.id}-next`, label: domain.id === 'bsp' ? 'Board bring-up' : 'Applied diagnosis', score: Math.max(0, domain.score - 12), level: domain.level, confidence: Math.max(0.35, domain.confidence - 0.1), state: 'ready', detail: 'A related transfer task will strengthen this path.', evidence: [], prerequisite: null, isReal: false }] }))
    // One card per taxonomy domain, topics in learning order; taxonomy topics without a mastery row show as not started.
    const rows = new Map(saved.mastery.map((item) => [`${stringValue(item.domain_id)}/${stringValue(item.topic_id)}`, item]))
    return DOMAINS.map((domain) => {
      const topics: SkillTopic[] = domain.topics.map((topic) => {
        const item = rows.get(`${domain.id}/${topic.id}`)
        if (!item) return { id: topic.id, label: topic.label, score: 0, level: 'Not started', confidence: 0, state: 'ready', detail: 'No evidence yet. Take a topic assessment to start this rating.', evidence: [], prerequisite: null, isReal: true }
        const evidenceSummary = recordValue(item.evidence_summary)
        if (isLearnedRow(item)) return { id: topic.id, label: topic.label, score: 0, level: 'Learned', confidence: 0, state: 'ready', detail: stringValue(evidenceSummary.recommended_focus, 'Learned, not assessed yet.'), evidence: [], prerequisite: null, isReal: true }
        const evidence = arrayValue(evidenceSummary.evidence).filter((line): line is string => typeof line === 'string')
        return { id: topic.id, label: topic.label, score: numberValue(item.score), level: stringValue(item.level_band, 'Basic'), confidence: numberValue(item.confidence), state: 'active', detail: stringValue(evidenceSummary.recommended_focus, 'No topic explanation has been recorded yet.'), evidence, prerequisite: null, isReal: true }
      })
      const assessed = topics.filter((topic) => topic.state === 'active')
      const score = assessed.length > 0 ? assessed.reduce((sum, topic) => sum + topic.score, 0) / assessed.length : 0
      const level = assessed.length > 0 ? (score >= 70 ? 'Advanced' : score >= 40 ? 'Intermediate' : 'Basic') : 'Not started'
      return { id: domain.id, label: domain.label, level, score, isReal: true, topics }
    })
  }, [sampleData, saved.mastery])
  // Home cards reuse the per-domain grouping from skillDomains: one card per domain, averaged over assessed topics.
  const homeDomains = useMemo<HomeDomain[]>(() => {
    if (sampleData) return SAMPLE_DOMAINS
    return skillDomains.map((domain) => {
      const assessed = domain.topics.filter((topic) => topic.state === 'active')
      const confidence = assessed.length > 0 ? assessed.reduce((sum, topic) => sum + topic.confidence, 0) / assessed.length : 0
      return { id: domain.id, label: domain.label, score: domain.score, level: domain.level, confidence, focus: assessed[0]?.detail ?? '', isReal: true }
    })
  }, [sampleData, skillDomains])

  const clearWorkspace = () => { setAnswerText(''); setJustification(''); setConfidence(''); setSelectedAnswers([]); setStatusMessage(null); setRawIndex(0); setCurrentSlot(0) }
  // Re-opening the exercise already loaded (lesson Start practice, review Retry) keeps its hint ladder, concealed again; any other activity has none of its own.
  const openPractice = (activity = activeActivity) => { const sameExercise = activity === selectedActivity; lessonRef.current = null; setSelectedActivity(activity); setHints((current) => sampleData ? SAMPLE_HINTS : sameExercise ? concealHints(current) : []); clearWorkspace(); setView('practice') }
  const postGenerate = async (payload?: { session_id: string; slot: number } | { domain_id: string; topic_id: string; topic_label: string }) => {
    let response: Response
    try { response = await authFetch('/api/assessment/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) }) } catch (error) { throw new HttpError(error instanceof Error ? error.message : 'Network error.') }
    const body: unknown = await response.json().catch(() => null)
    const record = recordValue(body)
    if (!response.ok || record.success !== true) throw new HttpError(stringValue(record.error, 'Assessment could not be generated.'), response.status)
    return recordValue(record.data)
  }
  const fetchExistingItem = async (sessionId: string, slot: number) => {
    const response = await authFetch('/api/assessment_items')
    const body: unknown = await response.json().catch(() => null)
    return arrayValue(recordValue(body).data).filter(isRecord).find((row) => stringValue(row.session_id) === sessionId && itemSlot(row) === slot)
  }
  // Up to 3 attempts with backoff for busy/gateway/network errors (lib/retry.ts); a 409 means the slot already exists, so use that item.
  const generateSlot = async (sessionId: string, slot: number) => {
    try {
      return await withRetry(async () => {
        const item = arrayValue((await postGenerate({ session_id: sessionId, slot })).items).filter(isRecord)[0]
        if (!item) throw new HttpError('Claude returned no question.', 502)
        return item
      })
    } catch (error) {
      const existing = error instanceof HttpError && error.status === 409 ? await fetchExistingItem(sessionId, slot).catch(() => undefined) : undefined
      if (existing) return existing
      throw error
    }
  }
  // Questions are written in the background (two at a time) while the learner answers; slots that still fail are kept in `missing` for a manual retry.
  const generateSlots = async (sessionId: string, slots: number[]) => {
    const queue = [...slots]
    const worker = async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const slot = next
        let item: JsonRecord | undefined
        let reason = ''
        try { item = await generateSlot(sessionId, slot) } catch (error) { reason = error instanceof Error ? error.message : 'Unknown error.' }
        setGenerated((current) => {
          if (!current || current.sessionId !== sessionId) return current
          const pending = Math.max(0, current.pending - 1)
          if (item) return { ...current, pending, items: insertBySlot(current.items, item) }
          return { ...current, pending, missing: [...current.missing.filter((entry) => entry.slot !== slot), { slot, reason }] }
        })
        if (!item) toast.error(`Question ${slot + 1} could not be generated: ${reason} Use Retry in the assessment to try again.`)
      }
    }
    await Promise.all([worker(), worker()])
  }
  const retryMissing = () => {
    if (!generated || generated.pending > 0 || generated.missing.length === 0) return
    const slots = generated.missing.map((entry) => entry.slot)
    setGenerated({ ...generated, missing: [], pending: slots.length })
    void generateSlots(generated.sessionId, slots)
  }
  const startAssessment = async (scope: { domainId: string; topicId: string } | null) => {
    if (generating) return
    setGenerating(true)
    const toastId = toast.loading(scope ? `Claude is writing your ${topicLabel(scope.domainId, scope.topicId)} question…` : 'Claude is writing your first question…')
    try {
      const data = await postGenerate(scope ? { domain_id: scope.domainId, topic_id: scope.topicId, topic_label: topicLabel(scope.domainId, scope.topicId) } : undefined)
      const session = recordValue(data.session)
      const items = arrayValue(data.items).filter(isRecord)
      const sessionId = stringValue(session.id)
      const total = Math.max(numberValue(session.total, items.length), items.length)
      if (items.length === 0 || !sessionId) throw new Error('Claude returned no questions.')
      setGenerated({ sessionId, total, items, coverage: arrayValue(session.topic_coverage).filter(isRecord).map((item) => ({ domain_id: stringValue(item.domain_id), topic_id: stringValue(item.topic_id), weight: numberValue(item.weight), subtopic: stringValue(item.subtopic) })), pending: total - 1, missing: [] })
      setAssessmentScope(scope)
      setWaitingNext(false)
      clearWorkspace()
      setView('assessment')
      toast.success(`Question 1 of ${total} is ready. The rest are being written.`, { id: toastId })
      void generateSlots(sessionId, Array.from({ length: total - 1 }, (_, index) => index + 1))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Assessment could not be generated.', { id: toastId })
    } finally {
      setGenerating(false)
    }
  }
  const openAssessment = () => startAssessment(null)
  const openTopicAssessment = (domainId: string, topicId: string) => startAssessment({ domainId, topicId })
  const advanceAssessment = (item?: JsonRecord) => { setAnswerText(''); setJustification(''); setConfidence(''); setSelectedAnswers([]); if (item) setCurrentSlot(itemSlot(item)) }
  const handleNextAssessment = () => {
    if (!generated) { setAnswerText(''); setJustification(''); setConfidence(''); setSelectedAnswers([]); setRawIndex((index) => Math.min(index + 1, assessmentQuestions.length - 1)); return }
    if (currentSlot + 1 >= generated.total) return
    const next = nextAvailable(generated, currentSlot)
    if (next === 'wait' && generated.pending > 0) { setWaitingNext(true); toast.info(`Question ${currentSlot + 2} is still being written. You will move on automatically.`); return }
    if (next === null || next === 'wait') { toast.error('The next question is missing because it could not be generated. Use Retry above the question.'); return }
    advanceAssessment(next)
  }
  useEffect(() => {
    if (!waitingNext || !generated) return
    const next = nextAvailable(generated, currentSlot)
    if (next !== null && next !== 'wait') { setWaitingNext(false); advanceAssessment(next) }
    else if (next === null || generated.pending === 0) setWaitingNext(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingNext, generated, currentSlot])
  const requestCoach = async (message: string, itemId?: string, target?: { url: string; body: unknown }) => {
    setActiveAgentId(CLAUDE_RUNTIME)
    try {
      const response = await authFetch(target?.url ?? '/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target?.body ?? { message, item_id: itemId }),
      })
      const result: unknown = await response.json()
      const resultRecord = recordValue(result)
      const responseRecord = recordValue(resultRecord.response)
      if (!response.ok || resultRecord.success !== true || responseRecord.status !== 'success') { const messageText = stringValue(responseRecord.message, stringValue(resultRecord.error, 'Claude CLI could not complete this request.')); setDataError(messageText); toast.error(messageText); return null }
      const normalized = normalizeCoachResult(responseRecord.result, responseRecord.metadata)
      if (!normalized) { const messageText = 'Claude CLI response did not match the saved learning schema. Nothing was marked complete.'; setDataError(messageText); toast.error(messageText); return null }
      if (resultRecord.replayed === true) return { ...normalized, replayed: { selected_answers: Array.isArray(resultRecord.selected_answers) ? resultRecord.selected_answers.filter((entry): entry is string => typeof entry === 'string') : [] } }
      return normalized
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Claude CLI could not be reached.'
      setDataError(messageText)
      toast.error(messageText)
      return null
    } finally {
      setActiveAgentId(null)
    }
  }
  // The lecture comes back first (cached per topic, so repeat visits are instant); the practice exercise is fetched in the background.
  // Lesson requests bypass requestCoach so a failure shows in the lesson view, not in the Home "Saved data" banner.
  const lessonRef = useRef<string | null>(null)
  const variantRef = useRef<string | null>(null) // lecture variant on screen, so the transfer exercise is graded against the same text
  const fetchLesson = async (body: JsonRecord) => {
    setActiveAgentId(CLAUDE_RUNTIME)
    try {
      const response = await authFetch('/api/lesson', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = recordValue(await response.json().catch(() => null))
      const responseRecord = recordValue(result.response)
      if (!response.ok || result.success !== true) throw new Error(stringValue(result.error, 'Claude CLI could not complete this request.'))
      const normalized = normalizeCoachResult(responseRecord.result, responseRecord.metadata)
      if (!normalized) throw new Error('Claude CLI response did not match the saved learning schema.')
      return normalized
    } finally { setActiveAgentId(null) }
  }
  const loadLessonPractice = async (domainId: string, topicId: string) => {
    const lessonId = `lesson-${domainId}-${topicId}`
    setLesson((current) => current && current.domainId === domainId && current.topicId === topicId ? { ...current, practice: 'loading' } : current)
    try {
      const practice = await fetchLesson({ domain_id: domainId, topic_id: topicId, part: 'practice' })
      if (lessonRef.current !== lessonId) return
      setSelectedActivity(practice.activity)
      setHints(concealHints(practice.hints))
      setLesson((current) => current && current.domainId === domainId && current.topicId === topicId ? { ...current, practice: 'ready' } : current)
    } catch {
      setLesson((current) => current && current.domainId === domainId && current.topicId === topicId ? { ...current, practice: 'error' } : current)
    }
  }
  // action: one of the lecture variants; regenerate: drop the cached lesson and write a new one. Neither one leaves the lesson view or loses the lesson id.
  const loadLesson = async (domainId: string, topicId: string, options: { action?: string; regenerate?: boolean } = {}) => {
    const lessonId = `lesson-${domainId}-${topicId}`
    const initial = !options.action && !options.regenerate && !(lessonRef.current === lessonId && lessonData)
    lessonRef.current = lessonId
    variantRef.current = options.action === 'adapt' ? 'adapted' : options.action ?? null
    setLesson((current) => ({ domainId, topicId, status: initial ? 'loading' : 'ready', error: null, variant: initial ? null : current?.variant ?? null, practice: current?.practice ?? 'loading', busy: !initial }))
    if (initial) { setLessonData(null); setRetrievalFeedback(null); setTransferResult(null); setTransferStatus('idle'); setTransferError(null) }
    try {
      // Opening a topic shows the adapted lecture when one exists (cached read, never calls Claude); any failure falls back silently to the base lecture.
      let action = options.action
      let adaptedResult: ReviewData | null = null
      if (initial) {
        adaptedResult = await fetchLesson({ domain_id: domainId, topic_id: topicId, part: 'lecture', action: 'adapt', cached_only: true }).catch(() => null)
        if (lessonRef.current !== lessonId) return
        if (adaptedResult) { action = 'adapt'; variantRef.current = 'adapted' }
      }
      const result = adaptedResult ?? await fetchLesson({ domain_id: domainId, topic_id: topicId, part: 'lecture', ...(options.action && { action: options.action }), ...(options.regenerate && { regenerate: true }) })
      if (lessonRef.current !== lessonId) return
      setLessonData(result)
      setClaudeState(fallbackClaudeFromReview(result))
      setLesson((current) => ({ domainId, topicId, status: 'ready', error: null, variant: action ? LESSON_VARIANTS[action] ?? null : null, practice: current?.practice ?? 'loading', busy: false }))
      if (!options.action) void loadLessonPractice(domainId, topicId)
      void loadTransferSaved(domainId, topicId, variantRef.current)
    } catch (error) {
      if (lessonRef.current !== lessonId) return
      const message = error instanceof Error ? error.message : 'Claude CLI could not be reached.'
      if (initial) setLesson({ domainId, topicId, status: 'error', error: message, variant: null, practice: 'loading', busy: false })
      else { setLesson((current) => current && { ...current, busy: false }); toast.error(message) }
    }
  }
  const startTopicLesson = (domainId: string, topicId: string) => {
    setAssessmentScope(null)
    setView('lesson')
    lessonRef.current = null // opening a topic is always an initial load, even when it is the lesson shown last
    void loadLesson(domainId, topicId)
  }
  const markLearned = async () => {
    if (!lesson || markingLearned) return
    setMarkingLearned(true)
    try {
      const response = await authFetch('/api/lesson/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain_id: lesson.domainId, topic_id: lesson.topicId }) })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok || !isRecord(body) || body.success !== true) throw new Error(isRecord(body) ? stringValue(body.error, 'Could not mark this lesson as learned.') : 'Could not mark this lesson as learned.')
      await refreshMastery()
      toast.success('Marked as learned. Take the topic assessment to get a rating.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not mark this lesson as learned.') } finally { setMarkingLearned(false) }
  }
  // Retrieval check stays on the generic /api/claude route (moving it into /api/lesson would need a new grading prompt and storage); feedback is shown inline so the lesson stays on screen.
  const lessonRetrievalSubmit = async (answer: string) => {
    if (!lessonData || !lesson || !answer.trim()) return
    setLesson({ ...lesson, busy: true })
    const result = await requestCoach(`request_type: review_request\nlesson: ${lessonData.activity.domain} / ${lessonData.activity.topic} (${lesson.domainId}/${lesson.topicId})\nretrieval check: ${lessonData.lecture.retrieval_check.prompt ?? ''}\nretrieval check answer: ${answer}\nanswer rule: ${lessonData.lecture.retrieval_check.answer_rule || 'Explain the reasoning.'}\nEvaluate the retrieval check and return the complete saved response schema; put the feedback for the learner in learner_explanation.`)
    if (result) setRetrievalFeedback(result.learner_explanation || result.feedback.summary || 'Retrieval check reviewed.')
    setLesson((current) => current && { ...current, busy: false })
  }
  // Transfer exercise: graded by POST /api/lesson/transfer (the server reads the exercise from the cached lesson). The lesson view and id are never touched.
  const loadTransferSaved = async (domainId: string, topicId: string, variant: string | null) => {
    const lessonId = `lesson-${domainId}-${topicId}`
    try {
      const response = await authFetch(`/api/lesson/transfer?domain_id=${domainId}&topic_id=${topicId}${variant ? `&variant=${variant}` : ''}`)
      const body = recordValue(await response.json().catch(() => null))
      if (lessonRef.current !== lessonId || variantRef.current !== variant) return
      setTransferResult(response.ok && body.success === true && isRecord(body.data) ? body.data as unknown as TransferResult : null)
      setTransferStatus('idle')
    } catch { /* saved work is optional; the exercise still works without it */ }
  }
  const lessonTransferSubmit = async (answer: string) => {
    if (!lesson || !answer.trim() || transferStatus === 'grading') return
    const { domainId, topicId } = lesson
    const lessonId = `lesson-${domainId}-${topicId}`
    setTransferStatus('grading'); setTransferError(null)
    try {
      const data = await withRetry(async () => {
        const response = await authFetch('/api/lesson/transfer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain_id: domainId, topic_id: topicId, answer, ...(variantRef.current && { variant: variantRef.current }) }) })
        const body = recordValue(await response.json().catch(() => null))
        if (!response.ok || body.success !== true) throw new HttpError(stringValue(body.error, 'Claude CLI could not grade this answer.'), response.status)
        return body.data as unknown as TransferResult
      })
      if (lessonRef.current !== lessonId) return
      setTransferResult(data); setTransferStatus('idle')
      await loadSavedData()
    } catch (error) {
      if (lessonRef.current !== lessonId) return
      setTransferError(error instanceof Error ? error.message : 'Claude CLI could not be reached.'); setTransferStatus('error')
    }
  }
  const persistAttempt = async (result: ReviewData) => {
    try {
      const response = await authFetch('/api/attempts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activity_id: (selectedActivity.id?.startsWith('lesson-') ? selectedActivity.id : result.activity.id) || selectedActivity.id || 'coach-activity', response: { answer: answerText, justification }, execution_result: { feedback: result.feedback.public_test_feedback, claude_cli: result.claude_cli }, score: result.feedback.correctness.score, hint_count: result.hints.filter((hint) => hint.revealed).length, feedback: { summary: result.feedback.summary, domain: result.activitySummary, format: result.request_type }, completion_state: 'completed' }) })
      const body: unknown = await response.json()
      if (!response.ok || !isRecord(body) || body.success !== true) throw new Error(isRecord(body) ? stringValue(body.error, 'Attempt could not be saved.') : 'Attempt could not be saved.')
      toast.success('Attempt saved to your learning history.')
      await loadSavedData()
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Attempt could not be saved.') }
  }
  const submitPractice = async () => {
    if (!answerText.trim()) return
    setLoading(true); setStatusMessage(null)
    const result = await requestCoach(`request_type: answer_submission\nactivity_id: ${selectedActivity.id ?? 'unassigned'}\ndomain_id: ${selectedActivity.domain_id ?? 'unknown'}\ntopic_id: ${selectedActivity.topic_id ?? 'unknown'}\nlearner response:\n${answerText}\nreasoning notes:\n${justification}\nhints revealed: ${hints.filter((hint) => hint.revealed).map((hint) => hint.stage).join(', ') || 'none'}\nexecution profile: ${JSON.stringify(selectedActivity.execution_profile)}\nEvaluate correctness, reasoning, public tests, safety, staged teaching, mastery evidence, assessment metadata, the next activity, and the Claude CLI bridge status.`)
    if (result) { setReview(result); setHints(result.hints); setClaudeState(fallbackClaudeFromReview(result)); setView('review'); await persistAttempt(result) }
    setLoading(false)
  }
  const submitAssessment = async () => {
    if (!answerText.trim() && selectedAnswers.length === 0) return
    setLoading(true); setStatusMessage(null)
    const currentItem = generated ? generated.items[Math.min(assessmentIndex, generated.items.length - 1)] : undefined
    const itemId = stringValue(currentItem?.id) || undefined
    const result = itemId
      ? await requestCoach('', undefined, { url: '/api/assessment/grade', body: { item_id: itemId, selected_answers: selectedAnswers.length > 0 ? selectedAnswers : [answerText], confidence, justification } })
      : await requestCoach(`request_type: assessment_submission\nitem_id: ${itemId ?? 'none'}\nmode: ${assessmentMeta.mode}\nquestion_index: ${assessmentIndex + 1}\nquestion: ${assessmentQuestion.stem}\nselected_answers: ${selectedAnswers.join(' | ') || answerText}\nconfidence: ${confidence || 'not supplied'}\nwritten justification: ${justification}\nassessment metadata: ${JSON.stringify(assessmentMeta)}\nDo not reveal correctness during the active assessment. After submission, return the complete structured review with valid or excluded items, misconception analysis, bounded mastery impact, explanations, remediation, and the Claude CLI runtime state.`, itemId)
    if (result) { setReview(result); setHints(result.hints); setClaudeState(fallbackClaudeFromReview(result)); setView('review'); if (itemId) await refreshMastery(); if (generated && generated.missing.length > 0) toast.warning(`${generated.items.length} of ${generated.total} questions were generated; this assessment is incomplete.`) }
    setLoading(false)
  }
  const saveDraft = async () => {
    setSaving(true)
    try { const response = await authFetch('/api/attempts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activity_id: selectedActivity.id || 'draft-activity', response: { answer: answerText, justification }, execution_result: { state: 'draft' }, score: '0', hint_count: hints.filter((hint) => hint.revealed).length, feedback: { state: 'draft' }, completion_state: 'draft' }) }); const body: unknown = await response.json(); if (!response.ok || !isRecord(body) || body.success !== true) throw new Error(isRecord(body) ? stringValue(body.error, 'Draft could not be saved.') : 'Draft could not be saved.'); toast.success('Draft saved.') } catch (error) { toast.error(error instanceof Error ? error.message : 'Draft could not be saved.') } finally { setSaving(false) }
  }
  const runTests = () => setStatusMessage('Isolated execution is not connected in this preview. Submit for coach evaluation; no test result was fabricated.')
  const revealHint = () => setHints((current) => { const index = current.findIndex((hint) => !hint.revealed); if (index < 0) return current; return current.map((hint, itemIndex) => itemIndex === index ? { ...hint, revealed: true } : hint) })
  const toggleAnswer = (value: string) => setSelectedAnswers((current) => current.includes(value) ? current.filter((answer) => answer !== value) : [...current, value])
  const handleLectureAction = async (action: string) => { if (!review) return; setLoading(true); const result = await requestCoach(`request_type: lecture_request\naction: ${action}\nlearner explanation: ${review.learner_explanation}\ncurrent lecture depth: ${review.lecture.selected_depth}\ncurrent lesson sections: ${review.lecture.sections.map((section) => section.title).join(' | ')}\nReturn the complete saved response schema with the requested teaching adjustment.`); if (result) { setReview(result); toast.success(`${action} ready.`) }; setLoading(false) }
  const handleRetrievalSubmit = async (answer: string) => { if (!review || !answer.trim()) return; setLoading(true); const result = await requestCoach(`request_type: review_request\nretrieval check answer: ${answer}\nanswer rule: ${review.lecture.retrieval_check.answer_rule || 'Explain the reasoning.'}\noriginal learner explanation: ${review.learner_explanation}\nEvaluate the retrieval check and return the complete saved response schema, including updated mastery evidence and next activity.`); if (result) { setReview(result); toast.success('Retrieval check reviewed.') }; setLoading(false) }
  // Topic practice: the same cached POST /api/lesson {part:'practice'} exercise the Lesson view uses (0 Claude calls when cached, one write otherwise).
  const practiceReqRef = useRef(0)
  // `next` asks the server for a NEW exercise of the topic (one Claude call, ~30-60s) unless the newest one is still untried; without it the newest cached exercise opens.
  const openTopicPractice = async (domainId: string, topicId: string, fromSkillMap = true, next = false) => {
    const request = ++practiceReqRef.current
    setPracticeLoad({ domainId, topicId, status: 'loading', error: null })
    try {
      const practice = await fetchLesson({ domain_id: domainId, topic_id: topicId, part: 'practice', ...(next ? { next: true } : {}) })
      if (practiceReqRef.current !== request) return
      setPracticeLoad(null)
      lessonRef.current = null; setSelectedActivity(practice.activity); setHints(concealHints(practice.hints)); clearWorkspace(); setView('practice')
    } catch (error) {
      if (practiceReqRef.current !== request) return
      const message = error instanceof Error ? error.message : 'Claude CLI could not be reached.'
      setPracticeLoad({ domainId, topicId, status: 'error', error: message })
      if (!fromSkillMap) toast.error(`Could not prepare the exercise. ${message}`, { action: { label: 'Retry', onClick: () => void openTopicPractice(domainId, topicId, false, next) } })
    }
  }
  const handlePracticeFromSkillMap = (topic: SkillTopic, domain: SkillDomain) => {
    if (domain.isReal && !sampleData) { void openTopicPractice(domain.id, topic.id); return }
    const topicActivity: PracticeActivity = { ...SAMPLE_ACTIVITY, id: `topic-${domain.id}-${topic.id}`, domain_id: domain.id, topic_id: topic.id, domain: domain.label, topic: topic.label, level_band: topic.level === 'Locked' || topic.level === 'Not started' ? 'Basic' : topic.level, prompt: `Practice ${topic.label} in ${domain.label}. Use the evidence panel to explain your approach before you submit.` }
    openPractice(topicActivity)
  }
  // Entries without a topic of their own (Home fallback, History): resume the most recently touched topic, otherwise let the learner pick one in the Skill Map.
  const openRecentPractice = () => {
    if (sampleData) { openPractice(); return }
    const row = saved.mastery.filter((item) => findTopic(stringValue(item.domain_id), stringValue(item.topic_id))).reduce<JsonRecord | undefined>((best, item) => (!best || stringValue(item.updated_at) > stringValue(best.updated_at) ? item : best), undefined)
    if (row) { toast.info('Preparing exercise…'); void openTopicPractice(stringValue(row.domain_id), stringValue(row.topic_id), false) }
    else { toast.info('Pick a topic in the Skill Map to practice it.'); setView('skill-map') }
  }
  // "Start next exercise" on the result screen: a NEW exercise of the topic that was just assessed or practiced (never the generic workspace exercise, never another topic).
  // Assessment results carry the topic in mastery_evidence; practice results keep the lesson activity. Unknown topic -> Skill Map.
  const nextStep = (() => {
    if (!review || sampleData) return null
    const fromAssessment = review.activity.format === 'assessment'
    const candidates = fromAssessment ? [review.mastery_evidence[0], review.activity, selectedActivity] : [selectedActivity, review.mastery_evidence[0], review.activity]
    const ref = candidates.find((item) => item && findTopic(stringValue(item.domain_id), stringValue(item.topic_id)))
    if (ref) return { kind: 'practice' as const, domainId: stringValue(ref.domain_id), topicId: stringValue(ref.topic_id), label: 'Start next exercise' }
    return { kind: 'map' as const, domainId: '', topicId: '', label: 'Choose a topic in Skill Map' }
  })()
  const startNextActivity = () => {
    if (!nextStep) return
    if (nextStep.kind === 'practice') void openTopicPractice(nextStep.domainId, nextStep.topicId, false, true)
    else setView('skill-map')
  }
  const handleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark')
  const handleSampleData = (checked: boolean) => { setSampleData(checked); if (!checked) toast.success('Sample examples removed. Saved data remains visible.'); else toast.success('Sample examples restored.') }
  const renderView = () => {
    if (view === 'home') return <HomeSection displayName={displayName} dateLabel={dateLabel} domains={homeDomains} attempts={homeAttempts} recommendation={homeRecommendation} sampleData={sampleData} dataError={dataError} onStartPractice={openRecentPractice} onOpenSkillMap={() => setView('skill-map')} onOpenHistory={() => setView('history')} onStartAssessment={openAssessment} domainOptions={DOMAIN_TOPIC_OPTIONS} onStartLearningTopic={startTopicLesson} onStartAssessmentTopic={openTopicAssessment} topicActionLoading={loading} />
    if (view === 'practice') return <PracticeSection mode="practice" activity={selectedActivity} hints={hints} claude={claudeState} assessmentQuestion={assessmentQuestion} assessmentIndex={generated ? currentSlot : assessmentIndex} assessmentTotal={generated ? generated.total : assessmentQuestions.length} assessmentCoverage={assessmentCoverage} assessmentMeta={assessmentMeta} generatedCount={generated?.items.length ?? assessmentQuestions.length} missingSlots={generated?.missing ?? []} retrying={(generated?.pending ?? 0) > 0} onRetryMissing={retryMissing} answerText={answerText} justification={justification} selectedAnswers={selectedAnswers} confidence={confidence} loading={loading} saving={saving} statusMessage={statusMessage} onChangeAnswer={setAnswerText} onChangeJustification={setJustification} onChangeConfidence={setConfidence} onToggleAnswer={toggleAnswer} onRevealHint={revealHint} onRun={runTests} onSaveDraft={saveDraft} onSubmit={submitPractice} onNextAssessment={() => { if (generated) { const item = generated.items[Math.min(assessmentIndex + 1, generated.items.length - 1)]; if (item) setCurrentSlot(itemSlot(item)) } else setRawIndex((index) => Math.min(index + 1, assessmentQuestions.length - 1)) }} onBack={() => setView('home')} onStartClaude={() => setStatusMessage('Claude CLI is the active tutor runtime. Submit your response to run it through the Linux host OAuth session.')} onCancelClaude={() => setStatusMessage('No Claude CLI request is currently running.')} />
    if (view === 'assessment') return <PracticeSection mode="assessment" activity={selectedActivity} hints={hints} claude={claudeState} assessmentQuestion={assessmentQuestion} assessmentIndex={generated ? currentSlot : assessmentIndex} assessmentTotal={generated ? generated.total : assessmentQuestions.length} assessmentCoverage={assessmentCoverage} assessmentMeta={assessmentMeta} generatedCount={generated?.items.length ?? assessmentQuestions.length} missingSlots={generated?.missing ?? []} retrying={(generated?.pending ?? 0) > 0} onRetryMissing={retryMissing} answerText={answerText} justification={justification} selectedAnswers={selectedAnswers} confidence={confidence} loading={loading} saving={saving} statusMessage={statusMessage} onChangeAnswer={setAnswerText} onChangeJustification={setJustification} onChangeConfidence={setConfidence} onToggleAnswer={toggleAnswer} onRevealHint={revealHint} onRun={runTests} onSaveDraft={saveDraft} onSubmit={submitAssessment} onNextAssessment={handleNextAssessment} onBack={() => setView('home')} onStartClaude={() => setStatusMessage('Claude CLI is the active tutor runtime. Submit your assessment to run it through the Linux host OAuth session.')} onCancelClaude={() => setStatusMessage('No Claude CLI request is currently running.')} />
    if (view === 'review' && review) return <ResultSection data={review} onStartNext={startNextActivity} nextLabel={nextStep?.label ?? 'Choose a topic in Skill Map'} starting={practiceLoad?.status === 'loading'} onRetry={() => openPractice(selectedActivity)} onBack={() => setView('home')} onLectureAction={handleLectureAction} onRetrievalSubmit={handleRetrievalSubmit} loading={loading} statusMessage={statusMessage} />
    if (view === 'lesson' && lesson) {
      const domain = findDomain(lesson.domainId); const topic = findTopic(lesson.domainId, lesson.topicId)
      const hasRow = (topicId: string) => saved.mastery.some((item) => stringValue(item.domain_id) === lesson.domainId && stringValue(item.topic_id) === topicId)
      const own = saved.mastery.find((item) => stringValue(item.domain_id) === lesson.domainId && stringValue(item.topic_id) === lesson.topicId)
      const refs = (ids: string[]) => ids.flatMap((id) => { const entry = findTopic(lesson.domainId, id); return entry ? [{ id, label: entry.label }] : [] })
      const next = domain?.topics.find((entry) => entry.order === (topic?.order ?? 0) + 1)
      return <LessonSection key={`${lesson.domainId}/${lesson.topicId}`} domainId={lesson.domainId} topicId={lesson.topicId} variantKey={lesson.variant ? (variantRef.current ?? null) : null} data={lessonData} status={lesson.status} error={lesson.error} domainLabel={domain?.label ?? lesson.domainId} topicLabel={topic?.label ?? lesson.topicId} subtopics={topic?.subtopics ?? []} prerequisites={refs(topic?.prerequisites ?? [])} missingPrerequisites={refs((topic?.prerequisites ?? []).filter((id) => !hasRow(id)))} nextTopic={next ? { id: next.id, label: next.label } : null} learnState={own ? (isLearnedRow(own) ? 'learned' : 'assessed') : 'none'} variantLabel={lesson.variant} practiceStatus={lesson.practice} busy={lesson.busy} marking={markingLearned} retrievalFeedback={retrievalFeedback} transferResult={transferResult} transferStatus={transferStatus} transferError={transferError}
        onBack={() => setView('home')} onRetry={() => void loadLesson(lesson.domainId, lesson.topicId)} onAction={(action) => void loadLesson(lesson.domainId, lesson.topicId, { action })} onShowOriginal={() => void loadLesson(lesson.domainId, lesson.topicId, {})} onRegenerate={() => { void loadLesson(lesson.domainId, lesson.topicId, { regenerate: true }) }} onMarkLearned={markLearned} onNextTopic={() => next && startTopicLesson(lesson.domainId, next.id)} onOpenTopic={(topicId) => startTopicLesson(lesson.domainId, topicId)}
        onStartPractice={() => openPractice(selectedActivity.id?.startsWith('lesson-') && selectedActivity.prompt ? selectedActivity : undefined)} onRetryPractice={() => void loadLessonPractice(lesson.domainId, lesson.topicId)} onRetrievalSubmit={(answer) => void lessonRetrievalSubmit(answer)} onTransferSubmit={(answer) => void lessonTransferSubmit(answer)} />
    }
    if (view === 'skill-map') return <SkillMapSection domains={skillDomains} sampleData={sampleData} loading={loading} onRetake={openAssessment} onPractice={handlePracticeFromSkillMap} practiceState={practiceLoad} onStartLesson={startTopicLesson} onAssess={openTopicAssessment} onBack={() => { practiceReqRef.current++; setPracticeLoad(null); setView('home') }} />
    if (view === 'history') return <HistoryPanel attempts={homeAttempts} sampleData={sampleData} onBack={() => setView('home')} onPractice={openRecentPractice} />
    return <ProfilePanel displayName={displayName} email={displayEmail} profile={saved.profile} sampleData={sampleData} onBack={() => setView('home')} onToggleSampleData={handleSampleData} />
  }
  return <div className="min-h-screen bg-background text-foreground antialiased"><div className="flex min-h-screen"><SideNavigation view={view} onNavigate={setView} displayName={displayName} /><div className="min-w-0 flex-1"><HeaderBar view={view} displayName={displayName} theme={theme} onToggleTheme={handleTheme} sampleData={sampleData} onToggleSampleData={handleSampleData} activeAgentId={activeAgentId} streak={sampleData ? 0 : headerStats.streak} exercises={sampleData ? 0 : headerStats.exercises} onNavigate={setView} /><MobileNavigation view={view} onNavigate={setView} /><main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{dataLoading ? <div className="mx-auto flex min-h-[22rem] max-w-4xl flex-col items-center justify-center gap-3 text-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /><p className="text-sm text-muted-foreground">Loading your learning desk…</p></div> : renderView()}</main></div></div></div>
}

export default function Page() {
  return <AuthProvider><Toaster richColors position="top-right" /><ProtectedRoute unauthenticatedFallback={<AuthScreen />}><EmbedPathApp /></ProtectedRoute></AuthProvider>
}
