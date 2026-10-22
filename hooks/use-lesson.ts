'use client'

import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { toast } from 'sonner'
import type { useAuth } from 'lyzr-architect-pg/client'
import type { PracticeActivity } from '@/app/sections/practice-section'
import type { TransferResult } from '@/app/sections/lesson-section'
import type { ReviewData } from '@/app/sections/result-section'
import { CLAUDE_RUNTIME, LESSON_VARIANTS, type ClaudeState, type JsonRecord, type LessonState, type ViewName } from '@/lib/app-types'
import { fallbackClaudeFromReview, isRecord, normalizeCoachResult, recordValue, stringValue } from '@/lib/normalize'
import { HttpError, withRetry } from '@/lib/retry'
import { concealHints, SAMPLE_HINTS } from '@/lib/sample-data'
import type { TopicRef } from '@/lib/practice-multi'

type LessonDeps = {
  authFetch: ReturnType<typeof useAuth>['authFetch']
  setActiveAgentId: Dispatch<SetStateAction<string | null>>
  setClaudeState: Dispatch<SetStateAction<ClaudeState>>
  setSelectedActivity: Dispatch<SetStateAction<PracticeActivity>>
  setHints: Dispatch<SetStateAction<typeof SAMPLE_HINTS>>
  setView: Dispatch<SetStateAction<ViewName>>
  setAssessmentScope: Dispatch<SetStateAction<{ domainId: string; topicId: string } | null>>
  clearWorkspace: () => void
  refreshMastery: () => Promise<void>
  loadSavedData: () => Promise<void>
}

// Lesson view, topic practice and transfer exercise: state plus the handlers that load, grade and mark them.
export function useLesson({ authFetch, setActiveAgentId, setClaudeState, setSelectedActivity, setHints, setView, setAssessmentScope, clearWorkspace, refreshMastery, loadSavedData }: LessonDeps) {
  const [lesson, setLesson] = useState<LessonState | null>(null)
  const [lessonData, setLessonData] = useState<ReviewData | null>(null)
  const [practiceLoad, setPracticeLoad] = useState<{ domainId: string; topicId: string; status: 'loading' | 'error'; error: string | null } | null>(null)
  const [markingLearned, setMarkingLearned] = useState(false)
  const [retrievalResult, setRetrievalResult] = useState<TransferResult | null>(null)
  const [retrievalStatus, setRetrievalStatus] = useState<'idle' | 'grading' | 'error'>('idle')
  const [retrievalError, setRetrievalError] = useState<string | null>(null)
  const [transferResult, setTransferResult] = useState<TransferResult | null>(null)
  const [transferStatus, setTransferStatus] = useState<'idle' | 'grading' | 'error'>('idle')
  const [transferError, setTransferError] = useState<string | null>(null)
  const [enriching, setEnriching] = useState<number[]>([])
  const [enrichErrors, setEnrichErrors] = useState<Record<number, string>>({})
  const lessonRef = useRef<string | null>(null)
  const variantRef = useRef<string | null>(null) // lecture variant on screen, so the transfer exercise is graded against the same text
  const practiceReqRef = useRef(0)

  // The lecture comes back first (cached per topic, so repeat visits are instant); the practice exercise is fetched in the background.
  // Lesson requests bypass requestCoach so a failure shows in the lesson view, not in the Home "Saved data" banner.
  const fetchLesson = async (body: JsonRecord) => {
    setActiveAgentId(CLAUDE_RUNTIME)
    try {
      const response = await authFetch('/api/lesson', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = recordValue(await response.json().catch(() => null))
      const responseRecord = recordValue(result.response)
      if (!response.ok || result.success !== true) throw new Error(stringValue(result.error, 'The AI provider could not complete this request.'))
      const normalized = normalizeCoachResult(responseRecord.result, responseRecord.metadata)
      if (!normalized) throw new Error('The AI response did not match the saved learning schema.')
      return normalized
    } finally { setActiveAgentId(null) }
  }
  // cachedOnly (when the lesson opens): reads a stored exercise, never calls Claude; a miss leaves the practice 'idle' until the learner presses Start practice.
  // Returns the exercise once it is ready, otherwise null.
  const loadLessonPractice = async (domainId: string, topicId: string, cachedOnly = false) => {
    const lessonId = `lesson-${domainId}-${topicId}`
    if (!cachedOnly) setLesson((current) => current && current.domainId === domainId && current.topicId === topicId ? { ...current, practice: 'loading' } : current)
    try {
      const practice = await fetchLesson({ domain_id: domainId, topic_id: topicId, part: 'practice', ...(cachedOnly && { cached_only: true }) })
      if (lessonRef.current !== lessonId) return null
      setSelectedActivity(practice.activity)
      setHints(concealHints(practice.hints))
      setLesson((current) => current && current.domainId === domainId && current.topicId === topicId ? { ...current, practice: 'ready' } : current)
      return practice.activity
    } catch {
      if (lessonRef.current === lessonId) setLesson((current) => current && current.domainId === domainId && current.topicId === topicId ? { ...current, practice: cachedOnly ? 'idle' : 'error' } : current)
      return null
    }
  }
  // action: one of the lecture variants; regenerate: drop the cached lesson and write a new one. Neither one leaves the lesson view or loses the lesson id.
  const loadLesson = async (domainId: string, topicId: string, options: { action?: string; regenerate?: boolean; cachedOnly?: boolean } = {}) => {
    const lessonId = `lesson-${domainId}-${topicId}`
    const initial = !options.action && !options.regenerate && !(lessonRef.current === lessonId && lessonData)
    lessonRef.current = lessonId
    variantRef.current = options.action === 'adapt' ? 'adapted' : options.action ?? null
    setLesson((current) => ({ domainId, topicId, status: initial ? 'loading' : 'ready', error: null, variant: initial ? null : current?.variant ?? null, practice: current?.practice ?? 'loading', busy: !initial }))
    if (initial) { setLessonData(null); setRetrievalResult(null); setRetrievalStatus('idle'); setRetrievalError(null); setTransferResult(null); setTransferStatus('idle'); setTransferError(null) }
    try {
      // Opening a topic shows the adapted lecture when one exists (cached read, never calls Claude); any failure falls back silently to the base lecture.
      let action = options.action
      let adaptedResult: ReviewData | null = null
      if (initial) {
        adaptedResult = await fetchLesson({ domain_id: domainId, topic_id: topicId, part: 'lecture', action: 'adapt', cached_only: true }).catch(() => null)
        if (lessonRef.current !== lessonId) return
        if (adaptedResult) { action = 'adapt'; variantRef.current = 'adapted' }
      }
      const result = adaptedResult ?? await fetchLesson({ domain_id: domainId, topic_id: topicId, part: 'lecture', ...(options.action && { action: options.action }), ...(options.cachedOnly && { cached_only: true }), ...(options.regenerate && { regenerate: true }) })
      if (lessonRef.current !== lessonId) return
      setLessonData(result)
      setClaudeState(fallbackClaudeFromReview(result))
      setLesson((current) => ({ domainId, topicId, status: 'ready', error: null, variant: action ? LESSON_VARIANTS[action] ?? null : null, practice: current?.practice ?? 'loading', busy: false }))
      if (!options.action) void loadLessonPractice(domainId, topicId, true)
      void loadSavedWork(domainId, topicId, variantRef.current)
    } catch (error) {
      if (lessonRef.current !== lessonId) return
      const message = error instanceof Error ? error.message : 'The AI provider could not be reached.'
      if (initial) setLesson({ domainId, topicId, status: 'error', error: message, variant: null, practice: 'loading', busy: false })
      else { setLesson((current) => current && { ...current, busy: false }); toast.error(message) }
    }
  }
  // Rewrites ONE section of the lecture from the learner's noted gaps (POST /api/lesson action 'enrich_section'), without blocking the page.
  // The lecture on screen switches to the stored enriched lecture, in which only the touched sections differ.
  const enrichSection = async (domainId: string, topicId: string, sectionIndex: number) => {
    const lessonId = `lesson-${domainId}-${topicId}`
    if (enriching.includes(sectionIndex)) return
    setEnriching((current) => [...current, sectionIndex]); setEnrichErrors(({ [sectionIndex]: _drop, ...rest }) => rest)
    try {
      const result = await fetchLesson({ domain_id: domainId, topic_id: topicId, part: 'lecture', action: 'enrich_section', section_index: sectionIndex })
      if (lessonRef.current !== lessonId) return
      const switched = variantRef.current !== 'adapted'
      variantRef.current = 'adapted'
      setLessonData(result)
      setLesson((current) => current && current.domainId === domainId && current.topicId === topicId ? { ...current, variant: LESSON_VARIANTS.adapt } : current)
      if (switched) void loadSavedWork(domainId, topicId, 'adapted')
    } catch (error) {
      if (lessonRef.current === lessonId) setEnrichErrors((current) => ({ ...current, [sectionIndex]: error instanceof Error ? error.message : 'The AI provider could not be reached.' }))
    } finally { setEnriching((current) => current.filter((item) => item !== sectionIndex)) }
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
  // Transfer exercise and retrieval check: both graded by POST /api/lesson/transfer (the server reads the prompt, and for retrieval the expected points, from the cached lesson).
  // The lesson view and id are never touched.
  const loadSavedWork = async (domainId: string, topicId: string, variant: string | null) => {
    const lessonId = `lesson-${domainId}-${topicId}`
    await Promise.all((['transfer', 'retrieval'] as const).map(async (kind) => {
      try {
        const response = await authFetch(`/api/lesson/transfer?kind=${kind}&domain_id=${domainId}&topic_id=${topicId}${variant ? `&variant=${variant}` : ''}`)
        const body = recordValue(await response.json().catch(() => null))
        if (lessonRef.current !== lessonId || variantRef.current !== variant) return
        const result = response.ok && body.success === true && isRecord(body.data) ? body.data as unknown as TransferResult : null
        if (kind === 'transfer') { setTransferResult(result); setTransferStatus('idle') } else { setRetrievalResult(result); setRetrievalStatus('idle') }
      } catch { /* saved work is optional; the exercise still works without it */ }
    }))
  }
  const submitAnswer = async (kind: 'transfer' | 'retrieval', answer: string) => {
    if (!lesson || !answer.trim() || (kind === 'transfer' ? transferStatus : retrievalStatus) === 'grading') return
    const { domainId, topicId } = lesson
    const lessonId = `lesson-${domainId}-${topicId}`
    const [setResult, setStatus, setError] = kind === 'transfer' ? [setTransferResult, setTransferStatus, setTransferError] as const : [setRetrievalResult, setRetrievalStatus, setRetrievalError] as const
    setStatus('grading'); setError(null)
    try {
      const data = await withRetry(async () => {
        const response = await authFetch('/api/lesson/transfer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, domain_id: domainId, topic_id: topicId, answer, ...(variantRef.current && { variant: variantRef.current }) }) })
        const body = recordValue(await response.json().catch(() => null))
        if (!response.ok || body.success !== true) throw new HttpError(stringValue(body.error, 'The AI provider could not grade this answer.'), response.status)
        return body.data as unknown as TransferResult
      })
      if (lessonRef.current !== lessonId) return
      setResult(data); setStatus('idle')
      await loadSavedData()
    } catch (error) {
      if (lessonRef.current !== lessonId) return
      setError(error instanceof Error ? error.message : 'The AI provider could not be reached.'); setStatus('error')
    }
  }
  const lessonRetrievalSubmit = (answer: string) => submitAnswer('retrieval', answer)
  const lessonTransferSubmit = (answer: string) => submitAnswer('transfer', answer)
  // Topic practice: the same cached POST /api/lesson {part:'practice'} exercise the Lesson view uses (0 Claude calls when cached, one write otherwise).
  // `next` asks the server for a NEW exercise of the topic (one Claude call, ~1-2 min) unless the newest one is still untried; without it the newest cached exercise opens.
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
      const message = error instanceof Error ? error.message : 'The AI provider could not be reached.'
      setPracticeLoad({ domainId, topicId, status: 'error', error: message })
      if (!fromSkillMap) toast.error(`Could not prepare the exercise. ${message}`, { action: { label: 'Retry', onClick: () => void openTopicPractice(domainId, topicId, false, next) } })
    }
  }

  // Multi-topic practice: ONE integrated exercise over 2-4 topics (POST /api/lesson {part:'practice', topics}); new ones take ~30-60 s, a cached set opens at once.
  // `next` asks for another exercise on the same topics (only written when the newest one has a completed attempt).
  const openMultiPractice = async (topics: TopicRef[], next = false) => {
    const request = ++practiceReqRef.current
    setPracticeLoad({ domainId: topics[0].domain_id, topicId: topics[0].topic_id, status: 'loading', error: null })
    try {
      const practice = await fetchLesson({ part: 'practice', topics, ...(next ? { next: true } : {}) })
      if (practiceReqRef.current !== request) return
      setPracticeLoad(null)
      lessonRef.current = null; setSelectedActivity(practice.activity); setHints(concealHints(practice.hints)); clearWorkspace(); setView('practice')
    } catch (error) {
      if (practiceReqRef.current !== request) return
      const message = error instanceof Error ? error.message : 'The AI provider could not be reached.'
      setPracticeLoad({ domainId: topics[0].domain_id, topicId: topics[0].topic_id, status: 'error', error: message })
      toast.error(`Could not prepare the exercise. ${message}`, { action: { label: 'Retry', onClick: () => void openMultiPractice(topics, next) } })
    }
  }

  return { lesson, lessonData, practiceLoad, setPracticeLoad, markingLearned, retrievalResult, retrievalStatus, retrievalError, transferResult, transferStatus, transferError, lessonRef, variantRef, practiceReqRef, loadLesson, loadLessonPractice, enrichSection, enriching, enrichErrors, startTopicLesson, markLearned, lessonRetrievalSubmit, lessonTransferSubmit, openTopicPractice, openMultiPractice }
}
