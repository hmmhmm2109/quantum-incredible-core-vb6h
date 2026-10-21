'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { AuthProvider, ProtectedRoute, useAuth } from 'lyzr-architect-pg/client'
import { Toaster, toast } from 'sonner'
import { AuthScreen, HeaderBar, MobileNavigation, SideNavigation } from '@/app/sections/app-shell'
import { HistoryPanel, ProfilePanel } from '@/app/sections/history-profile-section'
import HomeSection, { type HomeAttempt, type HomeRecommendation } from '@/app/sections/home-section'
import PracticeSection, { type AssessmentQuestion, type PracticeActivity } from '@/app/sections/practice-section'
import LessonSection from '@/app/sections/lesson-section'
import ResultSection, { type ReviewData } from '@/app/sections/result-section'
import SkillMapSection, { type SkillDomain, type SkillTopic } from '@/app/sections/skill-map-section'
import { useLesson } from '@/hooks/use-lesson'
import { useSavedData } from '@/hooks/use-saved-data'
import { CLAUDE_RUNTIME, type ClaudeState, type GeneratedAssessment, type JsonRecord, type ViewName } from '@/lib/app-types'
import { insertBySlot, itemSlot, nextAvailable } from '@/lib/assessment-slots'
import { buildAssessmentCoverage, buildAssessmentMeta, buildAssessmentProgress, selectGeneratedQuestion } from '@/lib/assessment-view'
import { activityStats, buildHomeAttempts, buildHomeDomains, buildHomeRecommendation, buildSkillDomains, isLearnedRow } from '@/lib/home-recommendation'
import { DOMAIN_TOPIC_OPTIONS, topicLabel } from '@/lib/learning-topics'
import { arrayValue, displayEmailFromUser, displayNameFromUser, fallbackClaudeFromReview, hasOwn, isRecord, normalizeActivity, normalizeCoachResult, normalizeQuestion, numberValue, recordValue, stringValue } from '@/lib/normalize'
import { HttpError, withRetry } from '@/lib/retry'
import { EMPTY_ACTIVITY, SAMPLE_ACTIVITY, SAMPLE_CLAUDE, SAMPLE_HINTS, SAMPLE_QUESTIONS, concealHints } from '@/lib/sample-data'
import { findDomain, findTopic } from '@/lib/taxonomy'

// Shown only if the stored item on screen has no stem or options; never another item's question.
const UNREADABLE_QUESTION: AssessmentQuestion = { stem: 'This question could not be displayed. Use Retry or start a new assessment.', options: [], type: 'single_answer', artifact: null }

function EmbedPathApp() {
  const { authFetch, user } = useAuth()
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
  const [review, setReview] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [claudeState, setClaudeState] = useState<ClaudeState>(SAMPLE_CLAUDE)
  const [generated, setGenerated] = useState<GeneratedAssessment | null>(null)
  const [generating, setGenerating] = useState(false)
  const [waitingNext, setWaitingNext] = useState(false)
  // Set while a resumed session is on screen (enables "Start a new assessment instead"); abandonedRef stops background question writing for sessions the learner discarded.
  const [resumedSessionId, setResumedSessionId] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const abandonedRef = useRef<Set<string>>(new Set())
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

  const clearWorkspace = () => { setAnswerText(''); setJustification(''); setConfidence(''); setSelectedAnswers([]); setStatusMessage(null); setRawIndex(0); setCurrentSlot(0) }
  // Re-opening the exercise already loaded (lesson Start practice, review Retry) keeps its hint ladder, concealed again; any other activity has none of its own.
  const openPractice = (activity = activeActivity, keepHints = false) => { const sameExercise = keepHints || activity === selectedActivity; lessonRef.current = null; setSelectedActivity(activity); setHints((current) => sampleData ? SAMPLE_HINTS : sameExercise ? concealHints(current) : []); clearWorkspace(); setView('practice') }
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
      for (let next = queue.shift(); next !== undefined && !abandonedRef.current.has(sessionId); next = queue.shift()) {
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
  // An unfinished session for the same scope (one topic, or the mixed diagnostic) is resumed instead of starting another one.
  const findResumable = (sessions: JsonRecord[], responses: JsonRecord[], scope: { domainId: string; topicId: string } | null) => [...sessions]
    .sort((a, b) => stringValue(b.created_at).localeCompare(stringValue(a.created_at)))
    .find((session) => {
      if (session.status !== 'in_progress') return false
      const plan = arrayValue(recordValue(session.timing_policy).plan)
      const answered = new Set(responses.filter((response) => stringValue(response.session_id) === stringValue(session.id)).map((response) => stringValue(response.item_id))).size
      if (plan.length === 0 || answered >= plan.length) return false
      const coverage = arrayValue(session.topic_coverage).filter(isRecord)
      return scope ? coverage.every((entry) => stringValue(entry.domain_id) === scope.domainId && stringValue(entry.topic_id) === scope.topicId) : new Set(coverage.map((entry) => `${stringValue(entry.domain_id)}/${stringValue(entry.topic_id)}`)).size > 1
    })
  const resumeAssessment = (session: JsonRecord, allItems: JsonRecord[], responses: JsonRecord[], scope: { domainId: string; topicId: string } | null) => {
    const sessionId = stringValue(session.id)
    const plan = arrayValue(recordValue(session.timing_policy).plan).filter(isRecord)
    const items = allItems.filter((item) => stringValue(item.session_id) === sessionId).reduce<JsonRecord[]>((list, item) => insertBySlot(list, item), [])
    const done = new Set(responses.map((response) => stringValue(response.item_id)))
    const absent = plan.map((entry) => numberValue(entry.slot)).filter((slot) => !items.some((item) => itemSlot(item) === slot))
    const open = items.find((item) => !done.has(stringValue(item.id)))
    setGenerated({ sessionId, total: plan.length, items, coverage: arrayValue(session.topic_coverage).filter(isRecord).map((entry) => ({ domain_id: stringValue(entry.domain_id), topic_id: stringValue(entry.topic_id), weight: numberValue(entry.weight), subtopic: stringValue(entry.subtopic) })), pending: absent.length, missing: [] })
    setAssessmentScope(scope)
    setResumedSessionId(sessionId)
    clearWorkspace()
    setCurrentSlot(itemSlot(open ?? items[items.length - 1]))
    setWaitingNext(!open && absent.length > 0)
    setView('assessment')
    toast.success(open ? `Resuming your assessment at question ${itemSlot(open) + 1} of ${plan.length}.` : 'Resuming your assessment. The next question is still being written.')
    if (absent.length > 0) void generateSlots(sessionId, absent)
  }
  const startAssessment = async (scope: { domainId: string; topicId: string } | null) => {
    if (generating) return
    setGenerating(true)
    const fresh = await loadAssessmentData().catch(() => null)
    const resumable = findResumable(fresh?.sessions ?? saved.assessmentSessions, fresh?.responses ?? saved.responses, scope)
    if (resumable) {
      resumeAssessment(resumable, fresh?.items ?? saved.assessmentItems, fresh?.responses ?? saved.responses, scope)
      setGenerating(false)
      return
    }
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
      setResumedSessionId(null)
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
  // "Start a new assessment instead": mark the resumed session abandoned (PATCH is owner-scoped; graded answers keep counting in mastery), then generate a fresh one for the same scope.
  const restartAssessment = async () => {
    const sessionId = resumedSessionId
    if (!sessionId || restarting || generating) return
    setRestarting(true)
    try {
      const response = await authFetch('/api/assessment_sessions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sessionId, status: 'abandoned' }) })
      const body = recordValue(await response.json().catch(() => null))
      if (!response.ok || body.success !== true) throw new Error(stringValue(body.error, 'The assessment could not be restarted.'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The assessment could not be restarted.')
      setRestarting(false)
      return
    }
    abandonedRef.current.add(sessionId)
    setSaved((current) => ({ ...current, assessmentSessions: current.assessmentSessions.filter((session) => stringValue(session.id) !== sessionId), assessmentItems: current.assessmentItems.filter((item) => stringValue(item.session_id) !== sessionId) }))
    setResumedSessionId(null)
    setRestarting(false)
    await startAssessment(assessmentScope)
  }
  const openAssessment = () => startAssessment(null)
  const openTopicAssessment = (domainId: string, topicId: string) => startAssessment({ domainId, topicId })
  const advanceAssessment = (item?: JsonRecord) => { setAnswerText(''); setJustification(''); setConfidence(''); setSelectedAnswers([]); if (item) setCurrentSlot(itemSlot(item)) }
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
      const progress = recordValue(resultRecord.session_progress)
      if (hasOwn(progress, 'total')) normalized.session_progress = { answered: numberValue(progress.answered), total: numberValue(progress.total), completed: progress.completed === true }
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
  const { lesson, lessonData, practiceLoad, setPracticeLoad, markingLearned, retrievalResult, retrievalStatus, retrievalError, transferResult, transferStatus, transferError, lessonRef, variantRef, practiceReqRef, loadLesson, loadLessonPractice, startTopicLesson, markLearned, lessonRetrievalSubmit, lessonTransferSubmit, openTopicPractice } = useLesson({ authFetch, setActiveAgentId, setClaudeState, setSelectedActivity, setHints, setView, setAssessmentScope, clearWorkspace, refreshMastery, loadSavedData })
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
  // Server-side grading is idempotent per item_id, so Submit and Save & next share this path.
  const gradeCurrent = async () => {
    const currentItem = generated ? generated.items[Math.min(assessmentIndex, generated.items.length - 1)] : undefined
    const itemId = stringValue(currentItem?.id) || undefined
    if (generated && !itemId) { toast.error('This question has no saved id. Reload the page and resume the assessment.'); return null }
    const result = itemId
      ? await requestCoach('', undefined, { url: '/api/assessment/grade', body: { item_id: itemId, selected_answers: selectedAnswers.length > 0 ? selectedAnswers : [answerText], confidence, justification } })
      : await requestCoach(`request_type: assessment_submission\nitem_id: ${itemId ?? 'none'}\nmode: ${assessmentMeta.mode}\nquestion_index: ${assessmentIndex + 1}\nquestion: ${assessmentQuestion.stem}\nselected_answers: ${selectedAnswers.join(' | ') || answerText}\nconfidence: ${confidence || 'not supplied'}\nwritten justification: ${justification}\nassessment metadata: ${JSON.stringify(assessmentMeta)}\nDo not reveal correctness during the active assessment. After submission, return the complete structured review with valid or excluded items, misconception analysis, bounded mastery impact, explanations, remediation, and the Claude CLI runtime state.`, itemId)
    if (result && itemId) { setGradedNow((current) => [...current, itemId]); await refreshMastery() }
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
    if (ref) return { kind: 'practice' as const, domainId: stringValue(ref.domain_id), topicId: stringValue(ref.topic_id), label: 'Start next exercise' }
    return { kind: 'map' as const, domainId: '', topicId: '', label: 'Choose a topic in Skill Map' }
  })()
  // After an assessment answer, offer the next ungraded question of the same session before moving on to an exercise.
  const nextQuestion = (() => {
    if (!generated || !review?.session_progress || review.session_progress.completed) return null
    const next = nextUnanswered(generated, currentSlot)
    return next === null ? null : { label: `Next question (${next + 1}/${generated.total})`, onClick: () => openSlot(generated, next) }
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
    if (view === 'practice') return <PracticeSection mode="practice" activity={selectedActivity} hints={hints} claude={claudeState} assessmentQuestion={assessmentQuestion} assessmentIndex={generated ? currentSlot : assessmentIndex} assessmentTotal={generated ? generated.total : assessmentQuestions.length} assessmentCoverage={assessmentCoverage} assessmentProgress={assessmentProgress} assessmentMeta={assessmentMeta} generatedCount={generated?.items.length ?? assessmentQuestions.length} missingSlots={generated?.missing ?? []} retrying={(generated?.pending ?? 0) > 0} onRetryMissing={retryMissing} answerText={answerText} justification={justification} selectedAnswers={selectedAnswers} confidence={confidence} loading={loading} saving={saving} statusMessage={statusMessage} onChangeAnswer={setAnswerText} onChangeJustification={setJustification} onChangeConfidence={setConfidence} onToggleAnswer={toggleAnswer} onRevealHint={revealHint} onRun={runTests} onSaveDraft={saveDraft} onSubmit={submitPractice} onNextAssessment={() => { if (generated) { const item = generated.items[Math.min(assessmentIndex + 1, generated.items.length - 1)]; if (item) setCurrentSlot(itemSlot(item)) } else setRawIndex((index) => Math.min(index + 1, assessmentQuestions.length - 1)) }} onBack={() => setView('home')} onStartClaude={() => setStatusMessage('Claude CLI is the active tutor runtime. Submit your response to run it through the Linux host OAuth session.')} onCancelClaude={() => setStatusMessage('No Claude CLI request is currently running.')} />
    if (view === 'assessment') return <PracticeSection mode="assessment" activity={selectedActivity} hints={hints} claude={claudeState} assessmentQuestion={assessmentQuestion} assessmentIndex={generated ? currentSlot : assessmentIndex} assessmentTotal={generated ? generated.total : assessmentQuestions.length} assessmentCoverage={assessmentCoverage} assessmentProgress={assessmentProgress} assessmentMeta={assessmentMeta} generatedCount={generated?.items.length ?? assessmentQuestions.length} missingSlots={generated?.missing ?? []} retrying={(generated?.pending ?? 0) > 0} onRetryMissing={retryMissing} answerText={answerText} justification={justification} selectedAnswers={selectedAnswers} confidence={confidence} loading={loading} saving={saving} statusMessage={statusMessage} onChangeAnswer={setAnswerText} onChangeJustification={setJustification} onChangeConfidence={setConfidence} onToggleAnswer={toggleAnswer} onRevealHint={revealHint} onRun={runTests} onSaveDraft={saveDraft} onSubmit={submitAssessment} onNextAssessment={handleNextAssessment} onRestartAssessment={resumedSessionId ? restartAssessment : undefined} restarting={restarting} currentAnswered={Boolean(generated && answeredIds.has(stringValue(generated.items[Math.min(assessmentIndex, generated.items.length - 1)]?.id)))} onBack={() => setView('home')} onStartClaude={() => setStatusMessage('Claude CLI is the active tutor runtime. Submit your assessment to run it through the Linux host OAuth session.')} onCancelClaude={() => setStatusMessage('No Claude CLI request is currently running.')} />
    if (view === 'review' && review) return <ResultSection data={review} onStartNext={startNextActivity} nextQuestion={nextQuestion} nextLabel={nextStep?.label ?? 'Choose a topic in Skill Map'} starting={practiceLoad?.status === 'loading'} onRetry={() => openPractice(selectedActivity)} onBack={() => setView('home')} onLectureAction={handleLectureAction} onRetrievalSubmit={handleRetrievalSubmit} onOpenLesson={startTopicLesson} onAskAbout={askAboutQuestion} loading={loading} statusMessage={statusMessage} />
    if (view === 'lesson' && lesson) {
      const domain = findDomain(lesson.domainId); const topic = findTopic(lesson.domainId, lesson.topicId)
      const hasRow = (topicId: string) => saved.mastery.some((item) => stringValue(item.domain_id) === lesson.domainId && stringValue(item.topic_id) === topicId)
      const own = saved.mastery.find((item) => stringValue(item.domain_id) === lesson.domainId && stringValue(item.topic_id) === lesson.topicId)
      const refs = (ids: string[]) => ids.flatMap((id) => { const entry = findTopic(lesson.domainId, id); return entry ? [{ id, label: entry.label }] : [] })
      const next = domain?.topics.find((entry) => entry.order === (topic?.order ?? 0) + 1)
      return <LessonSection key={`${lesson.domainId}/${lesson.topicId}`} domainId={lesson.domainId} topicId={lesson.topicId} variantKey={lesson.variant ? (variantRef.current ?? null) : null} data={lessonData} status={lesson.status} error={lesson.error} domainLabel={domain?.label ?? lesson.domainId} topicLabel={topic?.label ?? lesson.topicId} subtopics={topic?.subtopics ?? []} prerequisites={refs(topic?.prerequisites ?? [])} missingPrerequisites={refs((topic?.prerequisites ?? []).filter((id) => !hasRow(id)))} nextTopic={next ? { id: next.id, label: next.label } : null} learnState={own ? (isLearnedRow(own) ? 'learned' : 'assessed') : 'none'} variantLabel={lesson.variant} practiceStatus={lesson.practice} busy={lesson.busy} marking={markingLearned} retrievalResult={retrievalResult} retrievalStatus={retrievalStatus} retrievalError={retrievalError} transferResult={transferResult} transferStatus={transferStatus} transferError={transferError}
        onBack={() => setView('home')} onRetry={() => void loadLesson(lesson.domainId, lesson.topicId)} onAction={(action) => void loadLesson(lesson.domainId, lesson.topicId, { action })} onShowOriginal={() => void loadLesson(lesson.domainId, lesson.topicId, {})} onRegenerate={() => { void loadLesson(lesson.domainId, lesson.topicId, { regenerate: true }) }} onMarkLearned={markLearned} onNextTopic={() => next && startTopicLesson(lesson.domainId, next.id)} onOpenTopic={(topicId) => startTopicLesson(lesson.domainId, topicId)}
        onStartPractice={async () => { if (lesson.practice === 'ready') { openPractice(selectedActivity.id?.startsWith('lesson-') && selectedActivity.prompt ? selectedActivity : undefined); return } const activity = await loadLessonPractice(lesson.domainId, lesson.topicId); if (activity) openPractice(activity, true) }} askPrefill={askPrefill} onAskPrefilled={() => setAskPrefill(null)} onRetryPractice={() => void loadLessonPractice(lesson.domainId, lesson.topicId)} onRetrievalSubmit={(answer) => void lessonRetrievalSubmit(answer)} onTransferSubmit={(answer) => void lessonTransferSubmit(answer)} />
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
