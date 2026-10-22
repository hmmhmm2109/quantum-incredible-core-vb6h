'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { AuthProvider, ProtectedRoute, useAuth } from 'lyzr-architect-pg/client'
import { Toaster, toast } from 'sonner'
import { getAiProviderShort, useLoadAiProvider } from '@/hooks/use-ai-provider'
import { AuthScreen, HeaderBar, MobileNavigation, SideNavigation } from '@/app/sections/app-shell'
import { HistoryPanel, ProfilePanel } from '@/app/sections/history-profile-section'
import { shortActivityTitle } from '@/lib/attempt-view'
import HomeSection, { type HomeAttempt, type HomeRecommendation } from '@/app/sections/home-section'
import PracticeSection, { type AssessmentQuestion, type PracticeActivity } from '@/app/sections/practice-section'
import LessonSection from '@/app/sections/lesson-section'
import ResultSection, { type ReviewData } from '@/app/sections/result-section'
import { RETAKE_MODE } from '@/lib/assessment-history'
import AssessmentPicker, { type CustomAssessmentRequest } from '@/app/sections/assessment-picker'
import SkillMapSection, { type SkillDomain, type SkillTopic } from '@/app/sections/skill-map-section'
import { useLesson } from '@/hooks/use-lesson'
import { useSavedData } from '@/hooks/use-saved-data'
import { CLAUDE_RUNTIME, type ClaudeState, type GeneratedAssessment, type JsonRecord, type ViewName } from '@/lib/app-types'
import { topicKey, type TopicRef } from '@/lib/assessment-plan'
import { insertBySlot, itemSlot, nextAvailable } from '@/lib/assessment-slots'
import { buildAssessmentCoverage, buildAssessmentMeta, buildAssessmentProgress, selectGeneratedQuestion } from '@/lib/assessment-view'
import { pickPracticeTopic, recentExercises, activityStats, buildHomeAttempts, buildHomeDomains, buildOverall, buildHomeRecommendation, buildSkillDomains, isLearnedRow } from '@/lib/home-recommendation'
import { DOMAIN_TOPIC_OPTIONS, topicLabel } from '@/lib/learning-topics'
import { arrayValue, displayEmailFromUser, displayNameFromUser, fallbackClaudeFromReview, hasOwn, isRecord, normalizeActivity, normalizeCoachResult, normalizeQuestion, numberValue, recordValue, stringValue } from '@/lib/normalize'
import { HttpError, withRetry } from '@/lib/retry'
import { EMPTY_ACTIVITY, SAMPLE_ACTIVITY, SAMPLE_CLAUDE, SAMPLE_HINTS, SAMPLE_QUESTIONS, concealHints } from '@/lib/sample-data'
import { findDomain, findTopic } from '@/lib/taxonomy'

// Shown only if the stored item on screen has no stem or options; never another item's question.
const UNREADABLE_QUESTION: AssessmentQuestion = { stem: 'This question could not be displayed. Use Retry or start a new assessment.', options: [], type: 'single_answer', artifact: null }

function EmbedPathApp() {
  const { authFetch, user } = useAuth()
  useLoadAiProvider(authFetch, !!user)
  const [view, setView] = useState<ViewName>('home')
  const [askPrefill, setAskPrefill] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [dateLabel, setDateLabel] = useState('Your learning desk')
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const { saved, setSaved, sampleData, setSampleData, dataLoading, dataError, setDataError, loadSavedData, loadAssessmentData, refreshMastery } = useSavedData(authFetch)
  const [selectedActivity, setSelectedActivity] = useState<PracticeActivity>(SAMPLE_ACTIVITY)
  const [hints, setHints] = useState(SAMPLE_HINTS)
  const [answerText, setAnswerText] = useState('')
  const [justification, setJustification] = useState('')
  const [confidence, setConfidence] = useState('')
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([])
  const [rawIndex, setRawIndex] = useState(0)
  const [currentSlot, setCurrentSlot] = useState(0)
  const [assessmentScope, setAssessmentScope] = useState<{ domainId: string; topicId: string } | null>(null)
  const [assessmentCustom, setAssessmentCustom] = useState<CustomAssessmentRequest | null>(null)
  const [review, setReview] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [claudeState, setClaudeState] = useState<ClaudeState>(SAMPLE_CLAUDE)
  const [generated, setGenerated] = useState<GeneratedAssessment | null>(null)
  const [generating, setGenerating] = useState(false)
  // History tab: the assessment open for review (from the list, or from the result screen: `from` decides where Back goes).
  const [historyReview, setHistoryReview] = useState<{ id: string; from: 'history' | 'result' } | null>(null)
  const [waitingNext, setWaitingNext] = useState(false)
  // Set while a resumed session is on screen (enables "Start a new assessment instead"); abandonedRef stops background question writing for sessions the learner discarded.
  const [resumedSessionId, setResumedSessionId] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const abandonedRef = useRef<Set<string>>(new Set())
  // Questions are written one ahead of the learner: a slot is generated only once the learner has reached the slot before it
  // (or asked for it), so leaving an assessment early never pays for questions nobody opened. runRef retires parked workers of an older call.
  const frontierRef = useRef<{ sessionId: string; slot: number }>({ sessionId: '', slot: 0 })
  const runRef = useRef(0)
  const reachSlot = (sessionId: string, slot: number) => { const f = frontierRef.current; frontierRef.current = { sessionId, slot: f.sessionId === sessionId ? Math.max(f.slot, slot) : slot } }
  // Items graded in this tab (saved.responses covers the ones graded earlier).
  const [gradedNow, setGradedNow] = useState<string[]>([])
  // Generated items are kept sorted by slot; the displayed question is tracked by slot so a late or retried question inserted before it never shifts the view.
  const assessmentIndex = generated ? Math.max(0, generated.items.findIndex((item) => itemSlot(item) === currentSlot)) : rawIndex

  useEffect(() => {
    const storedTheme = window.localStorage.getItem('theme')
    if (storedTheme === 'dark' || storedTheme === 'light') setTheme(storedTheme)
    setDateLabel(new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()))
  }, [])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [view])
  useEffect(() => { if (view !== 'lesson') setAskPrefill(null) }, [view])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    window.localStorage.setItem('theme', theme)
  }, [theme])

  const realActivity = useMemo(() => normalizeActivity(saved.activities[0]), [saved.activities])
  const activeActivity = sampleData ? SAMPLE_ACTIVITY : realActivity ?? EMPTY_ACTIVITY
  const headerStats = useMemo(() => activityStats(saved), [saved])
  const displayName = displayNameFromUser(user)
  const displayEmail = displayEmailFromUser(user)
  const homeAttempts = useMemo<HomeAttempt[]>(() => buildHomeAttempts(sampleData, saved.attempts), [sampleData, saved.attempts])
  const homeRecommendation = useMemo<HomeRecommendation>(() => buildHomeRecommendation(sampleData, saved.mastery, saved.recommendations), [sampleData, saved.recommendations, saved.mastery])
  const assessmentQuestions = useMemo(() => { if (generated) { const fresh = generated.items.map(normalizeQuestion).filter((item): item is AssessmentQuestion => item !== null); if (fresh.length > 0) return fresh } if (sampleData) return SAMPLE_QUESTIONS; const normalized = saved.assessmentItems.map(normalizeQuestion).filter((item): item is AssessmentQuestion => item !== null); return normalized.length > 0 ? normalized : SAMPLE_QUESTIONS.slice(0, 1) }, [generated, sampleData, saved.assessmentItems])
  // Generated sessions read the item at assessmentIndex directly (assessmentQuestions drops invalid items, which would shift the position by one).
  const assessmentQuestion = (generated ? selectGeneratedQuestion(generated, assessmentIndex) ?? UNREADABLE_QUESTION : assessmentQuestions[Math.min(assessmentIndex, assessmentQuestions.length - 1)]) ?? SAMPLE_QUESTIONS[0]
  const assessmentSession = saved.assessmentSessions[0]
  const assessmentCoverage = useMemo(() => buildAssessmentCoverage(sampleData, generated, assessmentSession), [generated, sampleData, assessmentSession])
  const assessmentMeta = useMemo(() => buildAssessmentMeta(sampleData, generated, assessmentIndex, assessmentSession, saved.assessmentItems), [generated, assessmentIndex, sampleData, assessmentSession, saved.assessmentItems])
  const skillDomains = useMemo(() => buildSkillDomains(sampleData, saved.mastery), [sampleData, saved.mastery])
  const homeDomains = useMemo(() => buildHomeDomains(sampleData, skillDomains), [sampleData, skillDomains])
  const overall = useMemo(() => buildOverall(sampleData, skillDomains), [sampleData, skillDomains])

  const clearWorkspace = () => { setAnswerText(''); setJustification(''); setConfidence(''); setSelectedAnswers([]); setStatusMessage(null); setRawIndex(0); setCurrentSlot(0) }
  // Re-opening the exercise already loaded (lesson Start practice, review Retry) keeps its hint ladder, concealed again; any other activity has none of its own.
  const openPractice = (activity = activeActivity, keepHints = false) => { const sameExercise = keepHints || activity === selectedActivity; lessonRef.current = null; setSelectedActivity(activity); setHints((current) => sampleData ? SAMPLE_HINTS : sameExercise ? concealHints(current) : []); clearWorkspace(); setView('practice') }
  const postGenerate = async (payload?: { session_id: string; slot: number; replace?: boolean } | { domain_id: string; topic_id: string; topic_label: string } | { topics: TopicRef[]; question_count: number; mode: string } | { retake_session_id: string }) => {
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
        if (!item) throw new HttpError(`${getAiProviderShort()} returned no question.`, 502)
        return item
      })
    } catch (error) {
      const existing = error instanceof HttpError && error.status === 409 ? await fetchExistingItem(sessionId, slot).catch(() => undefined) : undefined
      if (existing) return existing
      throw error
    }
  }
  // Questions are written in the background, one ahead of the learner, while they answer; slots that still fail are kept in `missing` for a manual retry.
  // `eager` (manual retry) skips the one-ahead wait because the learner already asked for those slots.
  const generateSlots = async (sessionId: string, slots: number[], eager = false) => {
    const queue = [...slots]
    const run = eager ? runRef.current : ++runRef.current
    const retired = () => abandonedRef.current.has(sessionId) || (!eager && runRef.current !== run)
    const worker = async () => {
      for (let next = queue.shift(); next !== undefined && !retired(); next = queue.shift()) {
        const slot = next
        while (!eager && !retired() && !(frontierRef.current.sessionId === sessionId && slot <= frontierRef.current.slot + 1)) await new Promise((resolve) => setTimeout(resolve, 500))
        if (retired()) return
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
    void generateSlots(generated.sessionId, slots, true)
  }
  // An unfinished session for the same scope (one topic, a custom topic list, or the mixed diagnostic) is resumed instead of starting another one.
  const sessionTopics = (session: JsonRecord) => arrayValue(session.topic_coverage).filter(isRecord).map((entry) => ({ domain_id: stringValue(entry.domain_id), topic_id: stringValue(entry.topic_id) }))
  const sameTopicSet = (a: TopicRef[], b: TopicRef[]) => { const left = new Set(a.map(topicKey)); const right = new Set(b.map(topicKey)); return left.size === right.size && [...left].every((key) => right.has(key)) }
  const findResumable = (sessions: JsonRecord[], responses: JsonRecord[], scope: { domainId: string; topicId: string } | null, custom?: { topics: TopicRef[]; mode: string } | null) => [...sessions]
    .sort((a, b) => stringValue(b.created_at).localeCompare(stringValue(a.created_at)))
    .find((session) => {
      if (session.status !== 'in_progress' || session.mode === RETAKE_MODE) return false // a practice retry is resumed from History only
      const plan = arrayValue(recordValue(session.timing_policy).plan)
      const answered = new Set(responses.filter((response) => stringValue(response.session_id) === stringValue(session.id)).map((response) => stringValue(response.item_id))).size
      if (plan.length === 0 || answered >= plan.length) return false
      const isCustom = recordValue(session.timing_policy).selection === 'custom'
      if (custom) return isCustom && stringValue(session.mode) === custom.mode && sameTopicSet(sessionTopics(session), custom.topics)
      if (isCustom) return false
      const coverage = arrayValue(session.topic_coverage).filter(isRecord)
      return scope ? coverage.every((entry) => stringValue(entry.domain_id) === scope.domainId && stringValue(entry.topic_id) === scope.topicId) : new Set(coverage.map((entry) => `${stringValue(entry.domain_id)}/${stringValue(entry.topic_id)}`)).size > 1
    })
  // For the picker: progress of the unfinished custom session with exactly this topic list, if any.
  const findUnfinished = (topics: TopicRef[], mode: string) => {
    const session = findResumable(saved.assessmentSessions, saved.responses, null, { topics, mode })
    if (!session) return null
    const ids = new Set(saved.assessmentItems.filter((item) => stringValue(item.session_id) === stringValue(session.id)).map((item) => stringValue(item.id)))
    return { answered: saved.responses.filter((response) => ids.has(stringValue(response.item_id))).length, total: arrayValue(recordValue(session.timing_policy).plan).length }
  }
  const resumeAssessment = (session: JsonRecord, allItems: JsonRecord[], responses: JsonRecord[], scope: { domainId: string; topicId: string } | null, custom: CustomAssessmentRequest | null = null) => {
    const sessionId = stringValue(session.id)
    const plan = arrayValue(recordValue(session.timing_policy).plan).filter(isRecord)
    const items = allItems.filter((item) => stringValue(item.session_id) === sessionId).reduce<JsonRecord[]>((list, item) => insertBySlot(list, item), [])
    const done = new Set(responses.map((response) => stringValue(response.item_id)))
    const absent = plan.map((entry) => numberValue(entry.slot)).filter((slot) => !items.some((item) => itemSlot(item) === slot))
    const open = items.find((item) => !done.has(stringValue(item.id)))
    setGenerated({ sessionId, mode: stringValue(session.mode, 'knowledge_check'), total: plan.length, items, coverage: arrayValue(session.topic_coverage).filter(isRecord).map((entry) => ({ domain_id: stringValue(entry.domain_id), topic_id: stringValue(entry.topic_id), weight: numberValue(entry.weight), subtopic: stringValue(entry.subtopic) })), pending: absent.length, missing: [] })
    setAssessmentScope(scope)
    setAssessmentCustom(custom)
    setResumedSessionId(sessionId)
    clearWorkspace()
    setCurrentSlot(itemSlot(open ?? items[items.length - 1]))
    reachSlot(sessionId, itemSlot(open ?? items[items.length - 1]))
    setWaitingNext(!open && absent.length > 0)
    setView('assessment')
    toast.success(open ? `Resuming your assessment at question ${itemSlot(open) + 1} of ${plan.length}.` : 'Resuming your assessment. The next question is still being written.')
    if (absent.length > 0) void generateSlots(sessionId, absent)
  }
  // `replaceId` = "start a new assessment instead" of that unfinished session: never resume (it or a sibling), write the new set first, close the old one only once the new one exists (a failed write leaves the old one open).
  const startAssessment = async (scope: { domainId: string; topicId: string } | null, custom: CustomAssessmentRequest | null = null, replaceId: string | null = null): Promise<boolean> => {
    if (generating) return false
    setGenerating(true)
    const fresh = await loadAssessmentData().catch(() => null)
    const sessions = fresh?.sessions ?? saved.assessmentSessions
    const responses = fresh?.responses ?? saved.responses
    // "Load new questions" / "Start a new assessment instead" / History retake: the unfinished set(s) being replaced are closed (graded answers keep counting) after the new set exists.
    const forceNew = Boolean(custom?.fresh || replaceId)
    const stale = new Set<string>(replaceId ? [replaceId] : [])
    if (custom?.fresh) for (const old of sessions.filter((session) => session.status === 'in_progress' && recordValue(session.timing_policy).selection === 'custom' && stringValue(session.mode) === custom.mode && sameTopicSet(sessionTopics(session), custom.topics))) stale.add(stringValue(old.id))
    const resumable = forceNew ? undefined : findResumable(sessions, responses, scope, custom)
    if (resumable) {
      resumeAssessment(resumable, fresh?.items ?? saved.assessmentItems, responses, scope, custom)
      setGenerating(false)
      return true
    }
    const toastId = toast.loading(custom ? `${getAiProviderShort()} is writing your first question…` : scope ? `${getAiProviderShort()} is writing your ${topicLabel(scope.domainId, scope.topicId)} question…` : `${getAiProviderShort()} is writing your first question…`)
    try {
      const data = await postGenerate(custom ? { topics: custom.topics, question_count: custom.count, mode: custom.mode } : scope ? { domain_id: scope.domainId, topic_id: scope.topicId, topic_label: topicLabel(scope.domainId, scope.topicId) } : undefined)
      const session = recordValue(data.session)
      const items = arrayValue(data.items).filter(isRecord)
      const sessionId = stringValue(session.id)
      const total = Math.max(numberValue(session.total, items.length), items.length)
      if (items.length === 0 || !sessionId) throw new Error(`${getAiProviderShort()} returned no questions.`)
      for (const id of stale) {
        abandonedRef.current.add(id)
        await authFetch('/api/assessment_sessions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: 'abandoned' }) }).catch(() => undefined)
      }
      if (stale.size > 0) void loadAssessmentData().then((data2) => setSaved((current) => ({ ...current, assessmentSessions: data2.sessions, assessmentItems: data2.items }))).catch(() => undefined)
      setGenerated({ sessionId, mode: stringValue(session.mode, 'knowledge_check'), total, items, coverage: arrayValue(session.topic_coverage).filter(isRecord).map((item) => ({ domain_id: stringValue(item.domain_id), topic_id: stringValue(item.topic_id), weight: numberValue(item.weight), subtopic: stringValue(item.subtopic) })), pending: total - 1, missing: [] })
      setAssessmentScope(scope)
      setAssessmentCustom(custom)
      setResumedSessionId(null)
      setWaitingNext(false)
      clearWorkspace()
      setView('assessment')
      toast.success(`Question 1 of ${total} is ready. The next one is written while you answer.`, { id: toastId })
      reachSlot(sessionId, 0)
      void generateSlots(sessionId, Array.from({ length: total - 1 }, (_, index) => index + 1))
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Assessment could not be generated.', { id: toastId })
      return false
    } finally {
      setGenerating(false)
    }
  }
  // "Start a new assessment instead": write a fresh set for the same scope (one topic, the custom topic list, or the mixed diagnostic, read from the resumed session), then mark the resumed session abandoned (graded answers keep counting in mastery).
  const restartRef = useRef(false)
  const restartAssessment = async () => {
    const sessionId = resumedSessionId
    if (!sessionId || restartRef.current || generating) return
    const old = saved.assessmentSessions.find((session) => stringValue(session.id) === sessionId)
    const policy = recordValue(old?.timing_policy)
    const topics = old ? sessionTopics(old) : []
    const mode = stringValue(old?.mode) === 'domain_assessment' ? 'domain_assessment' : 'knowledge_check'
    const custom: CustomAssessmentRequest | null = assessmentCustom ?? (policy.selection === 'custom' && topics.length > 0 ? { topics, count: Math.max(3, Math.min(10, arrayValue(policy.plan).length)), mode, fresh: false } : null)
    const scope = custom ? null : assessmentScope ?? (topics.length === 1 ? { domainId: topics[0].domain_id, topicId: topics[0].topic_id } : null)
    restartRef.current = true
    setRestarting(true)
    try {
      await startAssessment(scope, custom, sessionId)
    } finally {
      restartRef.current = false
      setRestarting(false)
    }
  }
  const openAssessment = () => startAssessment(null)
  const openAssessmentPicker = () => { setView('assess-setup') }
  const startCustomAssessment = (request: CustomAssessmentRequest) => startAssessment(null, request)
  // "New questions on the same topics": closes nothing that is unfinished (only offered once a set is done) and writes a fresh set for the topics of the session on screen.
  const reloadQuestions = () => {
    if (!generated) return
    const topics = generated.coverage.filter((entry, index, all) => all.findIndex((other) => other.domain_id === entry.domain_id && other.topic_id === entry.topic_id) === index).map((entry) => ({ domain_id: entry.domain_id, topic_id: entry.topic_id }))
    const mode = generated.mode === 'domain_assessment' ? 'domain_assessment' : 'knowledge_check'
    void startAssessment(null, { topics, count: Math.max(3, Math.min(10, generated.total)), mode, fresh: true })
  }
  const openTopicAssessment = (domainId: string, topicId: string) => startAssessment({ domainId, topicId })
  // History: "Retake this topic" = a fresh set (same topics, same count) through the same path as "New questions".
  const retakeFromHistory = (session: { topics: TopicRef[]; mode: string; question_count: number }) => {
    const topics = session.topics.map((entry) => ({ domain_id: entry.domain_id, topic_id: entry.topic_id }))
    setHistoryReview(null)
    void startAssessment(null, { topics, count: Math.max(3, Math.min(10, session.question_count)), mode: session.mode === 'domain_assessment' ? 'domain_assessment' : 'knowledge_check', fresh: true })
  }
  // History: "Retry the same questions" = the server copies the items into a review_retake session (no AI call, no mastery effect).
  const retrySameFromHistory = async (sourceId: string) => {
    if (generating) return
    setGenerating(true)
    try {
      const data = await postGenerate({ retake_session_id: sourceId })
      const session = recordValue(data.session)
      const items = arrayValue(data.items).filter(isRecord).reduce<JsonRecord[]>((list, item) => insertBySlot(list, item), [])
      const sessionId = stringValue(session.id)
      if (items.length === 0 || !sessionId) throw new Error('No questions to retry.')
      setGenerated({ sessionId, mode: stringValue(session.mode, RETAKE_MODE), total: items.length, items, coverage: arrayValue(session.topic_coverage).filter(isRecord).map((item) => ({ domain_id: stringValue(item.domain_id), topic_id: stringValue(item.topic_id), weight: numberValue(item.weight), subtopic: stringValue(item.subtopic) })), pending: 0, missing: [] })
      setAssessmentScope(null); setAssessmentCustom(null); setResumedSessionId(null); setWaitingNext(false); clearWorkspace(); setHistoryReview(null); setView('assessment')
      reachSlot(sessionId, 0)
      toast.success('Same questions, new answer order. This is practice: your mastery will not change.')
      void loadAssessmentData().then((data2) => setSaved((current) => ({ ...current, assessmentSessions: data2.sessions, assessmentItems: data2.items }))).catch(() => undefined)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The questions could not be retried.')
    } finally {
      setGenerating(false)
    }
  }
  // History: Resume an unfinished session (reads fresh data, then the same path as the automatic resume).
  const resumeFromHistory = async (sessionId: string) => {
    if (generating) return
    const fresh = await loadAssessmentData().catch(() => null)
    const session = fresh?.sessions.find((entry) => stringValue(entry.id) === sessionId)
    if (!fresh || !session || session.status !== 'in_progress') { toast.error('This assessment can no longer be resumed.'); return }
    const topics = sessionTopics(session)
    const policy = recordValue(session.timing_policy)
    const plan = arrayValue(policy.plan).length
    const mode = (stringValue(session.mode) === 'domain_assessment' ? 'domain_assessment' : 'knowledge_check') as 'domain_assessment' | 'knowledge_check'
    const custom = policy.selection === 'custom' || session.mode === RETAKE_MODE ? { topics, count: Math.max(3, Math.min(10, plan)), mode, fresh: false } : null
    const scope = !custom && topics.length === 1 ? { domainId: topics[0].domain_id, topicId: topics[0].topic_id } : null
    setHistoryReview(null)
    resumeAssessment(session, fresh.items, fresh.responses, scope, custom)
    if (session.mode === RETAKE_MODE) setResumedSessionId(null) // "start a new assessment instead" does not apply to a practice retry
  }
  const advanceAssessment = (item?: JsonRecord) => { setAnswerText(''); setJustification(''); setConfidence(''); setSelectedAnswers([]); if (item) { setCurrentSlot(itemSlot(item)); if (generated) reachSlot(generated.sessionId, itemSlot(item)) } }
  const answeredIds = useMemo(() => new Set([...saved.responses.map((response) => stringValue(response.item_id)), ...gradedNow]), [saved.responses, gradedNow])
  const assessmentProgress = useMemo(() => buildAssessmentProgress(generated, currentSlot, answeredIds), [generated, currentSlot, answeredIds])
  // First slot after `slot` (then earlier ones) whose question has not been graded yet; slots without a question yet count as open.
  const nextUnanswered = (gen: NonNullable<typeof generated>, slot: number, justGraded?: string): number | null => {
    for (let step = 1; step < gen.total; step++) {
      const candidate = (slot + step) % gen.total
      const item = gen.items.find((entry) => itemSlot(entry) === candidate)
      if (!item || !(answeredIds.has(stringValue(item.id)) || stringValue(item.id) === justGraded)) return candidate
    }
    return null
  }
  const openSlot = (gen: NonNullable<typeof generated>, slot: number) => {
    const item = gen.items.find((entry) => itemSlot(entry) === slot)
    if (item) { advanceAssessment(item); setView('assessment'); return }
    reachSlot(gen.sessionId, slot)
    if (gen.pending > 0) toast.info(`Question ${slot + 1} is still being written. Try again in a moment.`)
    else { toast.info(`Question ${slot + 1} is missing; retrying it now.`); retryMissing() }
  }
  const handleNextAssessment = async () => {
    if (!generated) { setAnswerText(''); setJustification(''); setConfidence(''); setSelectedAnswers([]); setRawIndex((index) => Math.min(index + 1, assessmentQuestions.length - 1)); return }
    if (!answerText.trim() && selectedAnswers.length === 0) return
    setLoading(true); setStatusMessage(null)
    const justGraded = stringValue(generated.items[Math.min(assessmentIndex, generated.items.length - 1)]?.id)
    const result = await gradeCurrent()
    setLoading(false)
    if (!result) return
    if (result.mastery_delta) toast.success(`${result.mastery_delta.delta >= 0 ? '+' : ''}${result.mastery_delta.delta} (${result.mastery_delta.after})`)
    const next = nextUnanswered(generated, currentSlot, justGraded)
    if (next === null || result.session_progress?.completed) { showReview(result); return }
    const item = generated.items.find((entry) => itemSlot(entry) === next)
    if (item) { advanceAssessment(item); return }
    reachSlot(generated.sessionId, next)
    if (generated.pending > 0) { setWaitingNext(true); toast.info(`Question ${next + 1} is still being written. You will move on automatically.`); return }
    toast.error(`Question ${next + 1} is missing because it could not be generated. Use Retry above the question.`)
  }
  useEffect(() => {
    if (!waitingNext || !generated) return
    const next = nextAvailable(generated, currentSlot)
    if (next !== null && next !== 'wait') { setWaitingNext(false); advanceAssessment(next) }
    else if (next === null || generated.pending === 0) setWaitingNext(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingNext, generated, currentSlot])
  const requestCoach = async (message: string, target?: { url: string; body: unknown }) => {
    setActiveAgentId(CLAUDE_RUNTIME)
    try {
      const response = await authFetch(target?.url ?? '/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target?.body ?? { message }),
      })
      const result: unknown = await response.json()
      const resultRecord = recordValue(result)
      const responseRecord = recordValue(resultRecord.response)
      if (!response.ok || resultRecord.success !== true || responseRecord.status !== 'success') { const messageText = stringValue(responseRecord.message, stringValue(resultRecord.error, 'The AI provider could not complete this request.')); setDataError(messageText); toast.error(messageText); return null }
      const normalized = normalizeCoachResult(responseRecord.result, responseRecord.metadata)
      if (!normalized) { const messageText = 'The AI response did not match the saved learning schema. Nothing was marked complete.'; setDataError(messageText); toast.error(messageText); return null }
      const progress = recordValue(resultRecord.session_progress)
      if (hasOwn(progress, 'total')) normalized.session_progress = { answered: numberValue(progress.answered), total: numberValue(progress.total), completed: progress.completed === true }
      if (resultRecord.replayed === true) return { ...normalized, replayed: { selected_answers: Array.isArray(resultRecord.selected_answers) ? resultRecord.selected_answers.filter((entry): entry is string => typeof entry === 'string') : [] } }
      return normalized
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'The AI provider could not be reached.'
      setDataError(messageText)
      toast.error(messageText)
      return null
    } finally {
      setActiveAgentId(null)
    }
  }
  const { lesson, lessonData, practiceLoad, setPracticeLoad, markingLearned, retrievalResult, retrievalStatus, retrievalError, transferResult, transferStatus, transferError, lessonRef, variantRef, practiceReqRef, loadLesson, loadLessonPractice, enrichSection, enriching, enrichErrors, startTopicLesson, markLearned, lessonRetrievalSubmit, lessonTransferSubmit, openTopicPractice } = useLesson({ authFetch, setActiveAgentId, setClaudeState, setSelectedActivity, setHints, setView, setAssessmentScope, clearWorkspace, refreshMastery, loadSavedData })
  const persistAttempt = async (result: ReviewData) => {
    try {
      const response = await authFetch('/api/attempts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activity_id: (selectedActivity.id?.startsWith('lesson-') ? selectedActivity.id : result.activity.id) || selectedActivity.id || 'coach-activity', response: { answer: answerText, justification }, execution_result: { feedback: result.feedback.public_test_feedback, claude_cli: result.claude_cli, max_score: result.feedback.correctness.max_score }, score: result.feedback.correctness.score, hint_count: result.hints.filter((hint) => hint.revealed).length, feedback: { summary: result.feedback.summary, domain: result.activitySummary, format: result.request_type, title: shortActivityTitle(result.activitySummary) ?? undefined, max_score: result.feedback.correctness.max_score, passed: result.feedback.correctness.max_score > 0 && result.feedback.correctness.score >= result.feedback.correctness.max_score }, completion_state: 'completed' }) })
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
  // Server-side grading is idempotent per item_id, so Submit and Save & next share this path.
  const gradeCurrent = async () => {
    const currentItem = generated ? generated.items[Math.min(assessmentIndex, generated.items.length - 1)] : undefined
    const itemId = stringValue(currentItem?.id) || undefined
    if (!itemId) { toast.error('This question has no saved id. Reload the page and resume the assessment.'); return null }
    const result = await requestCoach('', { url: '/api/assessment/grade', body: { item_id: itemId, selected_answers: selectedAnswers.length > 0 ? selectedAnswers : [answerText], confidence, justification } })
    if (result) { setGradedNow((current) => [...current, itemId]); await refreshMastery() }
    return result
  }
  const showReview = (result: ReviewData) => { setReview(result); setHints(result.hints); setClaudeState(fallbackClaudeFromReview(result)); setView('review'); if (generated && generated.missing.length > 0) toast.warning(`${generated.items.length} of ${generated.total} questions were generated; this assessment is incomplete.`) }
  const submitAssessment = async () => {
    if (!answerText.trim() && selectedAnswers.length === 0) return
    setLoading(true); setStatusMessage(null)
    const result = await gradeCurrent()
    if (result) showReview(result)
    setLoading(false)
  }
  const saveDraft = async () => {
    setSaving(true)
    try { const response = await authFetch('/api/attempts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activity_id: selectedActivity.id || 'draft-activity', response: { answer: answerText, justification }, execution_result: { state: 'draft' }, score: '0', hint_count: hints.filter((hint) => hint.revealed).length, feedback: { state: 'draft' }, completion_state: 'draft' }) }); const body: unknown = await response.json(); if (!response.ok || !isRecord(body) || body.success !== true) throw new Error(isRecord(body) ? stringValue(body.error, 'Draft could not be saved.') : 'Draft could not be saved.'); toast.success('Draft saved.') } catch (error) { toast.error(error instanceof Error ? error.message : 'Draft could not be saved.') } finally { setSaving(false) }
  }
  const runTests = () => setStatusMessage('Isolated execution is not connected in this preview. Submit for coach evaluation; no test result was fabricated.')
  const revealHint = () => setHints((current) => { const index = current.findIndex((hint) => !hint.revealed); if (index < 0) return current; return current.map((hint, itemIndex) => itemIndex === index ? { ...hint, revealed: true } : hint) })
  const toggleAnswer = (value: string) => setSelectedAnswers((current) => current.includes(value) ? current.filter((answer) => answer !== value) : [...current, value])
  // "Ask about this" on a wrong answer: open the topic's lesson with the question box prefilled (the learner finishes the sentence; nothing is sent).
  const askAboutQuestion = (domainId: string, topicId: string, stem: string) => {
    const clipped = stem.replace(/\s+/g, ' ').trim()
    setAskPrefill(`About this question: "${clipped.length > 200 ? `${clipped.slice(0, 200).trimEnd()}…` : clipped}" — I don't understand why `)
    startTopicLesson(domainId, topicId)
  }
  const handleLectureAction = async (action: string) => { if (!review) return; setLoading(true); const result = await requestCoach(`request_type: lecture_request\naction: ${action}\nlearner explanation: ${review.learner_explanation}\ncurrent lecture depth: ${review.lecture.selected_depth}\ncurrent lesson sections: ${review.lecture.sections.map((section) => section.title).join(' | ')}\nReturn the complete saved response schema with the requested teaching adjustment.`); if (result) { setReview(result); toast.success(`${action} ready.`) }; setLoading(false) }
  const handleRetrievalSubmit = async (answer: string) => { if (!review || !answer.trim()) return; setLoading(true); const result = await requestCoach(`request_type: review_request\nretrieval check answer: ${answer}\nanswer rule: ${review.lecture.retrieval_check.answer_rule || 'Explain the reasoning.'}\noriginal learner explanation: ${review.learner_explanation}\nEvaluate the retrieval check and return the complete saved response schema, including updated mastery evidence and next activity.`); if (result) { setReview(result); toast.success('Retrieval check reviewed.') }; setLoading(false) }
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
    if (ref) return { kind: 'practice' as const, domainId: stringValue(ref.domain_id), topicId: stringValue(ref.topic_id), label: fromAssessment ? 'Start a code exercise on this topic' : 'Start next exercise' }
    return { kind: 'map' as const, domainId: '', topicId: '', label: 'Choose a topic in Skill Map' }
  })()
  // After an assessment answer, offer the next ungraded question of the same session before moving on to an exercise.
  const nextQuestion = (() => {
    if (!generated || !review?.session_progress || review.session_progress.completed) return null
    const next = nextUnanswered(generated, currentSlot)
    return next === null ? null : { label: `Next question (${next + 1}/${generated.total})`, onClick: () => openSlot(generated, next) }
  })()
  // Once a set has no unanswered question left, offer a fresh set on the same topics.
  const newQuestions = !sampleData && generated && review?.activity.format === 'assessment' && !nextQuestion ? { label: new Set(generated.coverage.map((entry) => `${entry.domain_id}/${entry.topic_id}`)).size === 1 ? 'New questions on this topic' : 'New questions on the same topics', onClick: reloadQuestions, busy: generating } : null
  const reviewAnswers = !sampleData && generated && review?.activity.format === 'assessment' ? { onClick: () => { setHistoryReview({ id: generated.sessionId, from: 'result' }); setView('history') } } : null
  const [replacing, setReplacing] = useState(false)
  // "Replace this question": the server swaps the unanswered item of this slot for a new one on the same topic (409 if it was answered meanwhile).
  const replaceQuestion = async () => {
    const current = generated?.items[Math.min(assessmentIndex, generated.items.length - 1)]
    if (!generated || !current || replacing || answeredIds.has(stringValue(current.id))) return
    const { sessionId } = generated
    const slot = itemSlot(current)
    setReplacing(true)
    try {
      const data = await withRetry(() => postGenerate({ session_id: sessionId, slot, replace: true }))
      const item = arrayValue(data.items).filter(isRecord)[0]
      if (!item) throw new Error(`${getAiProviderShort()} returned no question.`)
      setGenerated((state) => state && state.sessionId === sessionId ? { ...state, items: state.items.map((entry) => itemSlot(entry) === slot ? item : entry) } : state)
      setSelectedAnswers([]); setAnswerText(''); setJustification(''); setConfidence('')
      toast.success('New question ready.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The question could not be replaced.')
    } finally {
      setReplacing(false)
    }
  }
  const startNextActivity = () => {
    if (!nextStep) return
    if (nextStep.kind === 'practice') void openTopicPractice(nextStep.domainId, nextStep.topicId, false, true)
    else setView('skill-map')
  }
  const handleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark')
  const handleSampleData = (checked: boolean) => { setSampleData(checked); if (!checked) toast.success('Sample examples removed. Saved data remains visible.'); else toast.success('Sample examples restored.') }
  const renderView = () => {
    if (view === 'home') return <HomeSection displayName={displayName} dateLabel={dateLabel} domains={homeDomains} overall={overall} attempts={homeAttempts} recommendation={homeRecommendation} sampleData={sampleData} dataError={dataError} onStartPractice={openRecentPractice} onOpenSkillMap={() => setView('skill-map')} onOpenHistory={() => setView('history')} onStartAssessment={openAssessmentPicker} domainOptions={DOMAIN_TOPIC_OPTIONS} onStartLearningTopic={startTopicLesson} onStartAssessmentTopic={openTopicAssessment} topicActionLoading={loading || practiceLoad?.status === 'loading'} codePractice={{ recommended: sampleData ? null : pickPracticeTopic(saved.mastery), recent: sampleData ? [] : recentExercises(saved.attempts) }} onStartCodeExercise={(domainId, topicId) => { toast.info('Preparing exercise…'); void openTopicPractice(domainId, topicId, false) }} />
    if (view === 'practice') return <PracticeSection mode="practice" activity={selectedActivity} hints={hints} claude={claudeState} assessmentQuestion={assessmentQuestion} assessmentIndex={generated ? currentSlot : assessmentIndex} assessmentTotal={generated ? generated.total : assessmentQuestions.length} assessmentCoverage={assessmentCoverage} assessmentProgress={assessmentProgress} assessmentMeta={assessmentMeta} generatedCount={generated?.items.length ?? assessmentQuestions.length} missingSlots={generated?.missing ?? []} retrying={(generated?.pending ?? 0) > 0} onRetryMissing={retryMissing} answerText={answerText} justification={justification} selectedAnswers={selectedAnswers} confidence={confidence} loading={loading} saving={saving} statusMessage={statusMessage} onChangeAnswer={setAnswerText} onChangeJustification={setJustification} onChangeConfidence={setConfidence} onToggleAnswer={toggleAnswer} onRevealHint={revealHint} onRun={runTests} onSaveDraft={saveDraft} onSubmit={submitPractice} onNextAssessment={() => { if (generated) { const item = generated.items[Math.min(assessmentIndex + 1, generated.items.length - 1)]; if (item) { setCurrentSlot(itemSlot(item)); reachSlot(generated.sessionId, itemSlot(item)) } } else setRawIndex((index) => Math.min(index + 1, assessmentQuestions.length - 1)) }} onBack={() => setView('home')} onStartClaude={() => setStatusMessage(`${getAiProviderShort()} CLI is the active tutor runtime. Submit your response to run it through the host\'s existing login.`)} onCancelClaude={() => setStatusMessage(`No ${getAiProviderShort()} CLI request is currently running.`)} />
    if (view === 'assessment') return <PracticeSection mode="assessment" activity={selectedActivity} hints={hints} claude={claudeState} assessmentQuestion={assessmentQuestion} assessmentIndex={generated ? currentSlot : assessmentIndex} assessmentTotal={generated ? generated.total : assessmentQuestions.length} assessmentCoverage={assessmentCoverage} assessmentProgress={assessmentProgress} assessmentMeta={assessmentMeta} generatedCount={generated?.items.length ?? assessmentQuestions.length} missingSlots={generated?.missing ?? []} retrying={(generated?.pending ?? 0) > 0} onRetryMissing={retryMissing} answerText={answerText} justification={justification} selectedAnswers={selectedAnswers} confidence={confidence} loading={loading} saving={saving} statusMessage={statusMessage} onChangeAnswer={setAnswerText} onChangeJustification={setJustification} onChangeConfidence={setConfidence} onToggleAnswer={toggleAnswer} onRevealHint={revealHint} onRun={runTests} onSaveDraft={saveDraft} onSubmit={submitAssessment} onNextAssessment={handleNextAssessment} onRestartAssessment={resumedSessionId ? restartAssessment : undefined} restarting={restarting} currentAnswered={Boolean(generated && answeredIds.has(stringValue(generated.items[Math.min(assessmentIndex, generated.items.length - 1)]?.id)))} onReplaceQuestion={generated && !sampleData ? replaceQuestion : undefined} replacing={replacing} onBack={() => setView('home')} onStartClaude={() => setStatusMessage(`${getAiProviderShort()} CLI is the active tutor runtime. Submit your assessment to run it through the host\'s existing login.`)} onCancelClaude={() => setStatusMessage(`No ${getAiProviderShort()} CLI request is currently running.`)} />
    if (view === 'review' && review) return <ResultSection data={review} onStartNext={startNextActivity} nextQuestion={nextQuestion} newQuestions={newQuestions} reviewAnswers={reviewAnswers} retrySame={newQuestions && generated ? { onClick: () => void retrySameFromHistory(generated.sessionId), busy: generating } : null} nextLabel={nextStep?.label ?? 'Choose a topic in Skill Map'} starting={practiceLoad?.status === 'loading'} onRetry={() => openPractice(selectedActivity)} onBack={() => setView('home')} onLectureAction={handleLectureAction} onRetrievalSubmit={handleRetrievalSubmit} onOpenLesson={startTopicLesson} onAskAbout={askAboutQuestion} loading={loading} statusMessage={statusMessage} />
    if (view === 'lesson' && lesson) {
      const domain = findDomain(lesson.domainId); const topic = findTopic(lesson.domainId, lesson.topicId)
      const hasRow = (topicId: string) => saved.mastery.some((item) => stringValue(item.domain_id) === lesson.domainId && stringValue(item.topic_id) === topicId)
      const own = saved.mastery.find((item) => stringValue(item.domain_id) === lesson.domainId && stringValue(item.topic_id) === lesson.topicId)
      const refs = (ids: string[]) => ids.flatMap((id) => { const entry = findTopic(lesson.domainId, id); return entry ? [{ id, label: entry.label }] : [] })
      const next = domain?.topics.find((entry) => entry.order === (topic?.order ?? 0) + 1)
      return <LessonSection key={`${lesson.domainId}/${lesson.topicId}`} domainId={lesson.domainId} topicId={lesson.topicId} variantKey={lesson.variant ? (variantRef.current ?? null) : null} data={lessonData} status={lesson.status} error={lesson.error} domainLabel={domain?.label ?? lesson.domainId} topicLabel={topic?.label ?? lesson.topicId} subtopics={topic?.subtopics ?? []} prerequisites={refs(topic?.prerequisites ?? [])} missingPrerequisites={refs((topic?.prerequisites ?? []).filter((id) => !hasRow(id)))} nextTopic={next ? { id: next.id, label: next.label } : null} learnState={own ? (isLearnedRow(own) ? 'learned' : 'assessed') : 'none'} variantLabel={lesson.variant} practiceStatus={lesson.practice} busy={lesson.busy} marking={markingLearned} retrievalResult={retrievalResult} retrievalStatus={retrievalStatus} retrievalError={retrievalError} transferResult={transferResult} transferStatus={transferStatus} transferError={transferError}
        onBack={() => setView('home')} onRetry={() => void loadLesson(lesson.domainId, lesson.topicId)} onAction={(action) => void loadLesson(lesson.domainId, lesson.topicId, { action })} onShowOriginal={() => void loadLesson(lesson.domainId, lesson.topicId, {})} enriching={enriching} enrichErrors={enrichErrors} onEnrichSection={(index) => void enrichSection(lesson.domainId, lesson.topicId, index)} onShowEnriched={() => void loadLesson(lesson.domainId, lesson.topicId, { action: 'adapt', cachedOnly: true })} onRegenerate={() => { void loadLesson(lesson.domainId, lesson.topicId, { regenerate: true }) }} onMarkLearned={markLearned} onNextTopic={() => next && startTopicLesson(lesson.domainId, next.id)} onOpenTopic={(topicId) => startTopicLesson(lesson.domainId, topicId)}
        onStartPractice={async () => { if (lesson.practice === 'ready') { openPractice(selectedActivity.id?.startsWith('lesson-') && selectedActivity.prompt ? selectedActivity : undefined); return } const activity = await loadLessonPractice(lesson.domainId, lesson.topicId); if (activity) openPractice(activity, true) }} askPrefill={askPrefill} onAskPrefilled={() => setAskPrefill(null)} onRetryPractice={() => void loadLessonPractice(lesson.domainId, lesson.topicId)} onRetrievalSubmit={(answer) => void lessonRetrievalSubmit(answer)} onTransferSubmit={(answer) => void lessonTransferSubmit(answer)} />
    }
    if (view === 'skill-map') return <SkillMapSection domains={skillDomains} sampleData={sampleData} loading={loading} onRetake={openAssessment} onPractice={handlePracticeFromSkillMap} practiceState={practiceLoad} onStartLesson={startTopicLesson} onAssess={openTopicAssessment} onBack={() => { practiceReqRef.current++; setPracticeLoad(null); setView('home') }} />
    if (view === 'assess-setup') return <AssessmentPicker skillDomains={skillDomains} sampleData={sampleData} busy={generating} findUnfinished={findUnfinished} onStart={startCustomAssessment} onBack={() => setView('home')} />
    if (view === 'history') return <HistoryPanel attempts={homeAttempts} sampleData={sampleData} authFetch={authFetch} review={historyReview} onReview={setHistoryReview} actions={{ busy: generating, onRetake: retakeFromHistory, onRetry: (id) => void retrySameFromHistory(id), onResume: (id) => void resumeFromHistory(id) }} onBackToResult={() => { setHistoryReview(null); setView(review ? 'review' : 'home') }} onBack={() => { setHistoryReview(null); setView('home') }} onPractice={openRecentPractice} />
    return <ProfilePanel displayName={displayName} email={displayEmail} profile={saved.profile} sampleData={sampleData} authFetch={authFetch} onBack={() => setView('home')} onToggleSampleData={handleSampleData} />
  }
  return <div className="min-h-screen bg-background text-foreground antialiased"><div className="flex min-h-screen"><SideNavigation view={view} onNavigate={setView} displayName={displayName} /><div className="min-w-0 flex-1"><HeaderBar view={view} displayName={displayName} theme={theme} onToggleTheme={handleTheme} sampleData={sampleData} onToggleSampleData={handleSampleData} activeAgentId={activeAgentId} streak={sampleData ? 0 : headerStats.streak} exercises={sampleData ? 0 : headerStats.exercises} onNavigate={setView} /><MobileNavigation view={view} onNavigate={setView} /><main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{dataLoading ? <div className="mx-auto flex min-h-[22rem] max-w-4xl flex-col items-center justify-center gap-3 text-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /><p className="text-sm text-muted-foreground">Loading your learning desk…</p></div> : renderView()}</main></div></div></div>
}

export default function Page() {
  return <AuthProvider><Toaster richColors position="top-right" /><ProtectedRoute unauthenticatedFallback={<AuthScreen />}><EmbedPathApp /></ProtectedRoute></AuthProvider>
}
