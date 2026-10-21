'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { useAuth } from 'lyzr-architect-pg/client'
import type { JsonRecord, SavedState } from '@/lib/app-types'
import { isRecord, numberValue, recordValue, stringValue } from '@/lib/normalize'

// Saved learning data (profile, mastery, attempts, assessments) read from the API routes, plus the sample-data switch that hides it.
export function useSavedData(authFetch: ReturnType<typeof useAuth>['authFetch']) {
  const [sampleData, setSampleData] = useState(true)
  const [saved, setSaved] = useState<SavedState>({ profile: null, mastery: [], activities: [], attempts: [], recommendations: [], assessmentSessions: [], assessmentItems: [], responses: [] })
  const [dataLoading, setDataLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)

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
  // Sessions and items without the abandoned ones, which stay in the database but never reach the UI.
  const loadAssessmentData = useCallback(async () => {
    const [sessionsBody, itemsBody, responsesBody] = await Promise.all(['/api/assessment_sessions', '/api/assessment_items', '/api/assessment_responses'].map((route) => authFetch(route).then((res) => res.json() as Promise<unknown>)))
    const rows = (body: unknown) => { const data = recordValue(body).data; if (!Array.isArray(data)) throw new Error('Saved assessment data could not be loaded.'); return data.filter(isRecord) }
    const all = rows(sessionsBody)
    const abandoned = new Set(all.filter((session) => session.status === 'abandoned').map((session) => stringValue(session.id)))
    return { sessions: all.filter((session) => session.status !== 'abandoned'), items: rows(itemsBody).filter((item) => !abandoned.has(stringValue(item.session_id))), responses: rows(responsesBody) }
  }, [authFetch])
  // The grade route persists the response and mastery; re-read mastery and stop showing sample data over it.
  const refreshMastery = useCallback(async () => {
    try {
      const response = await authFetch('/api/topic_mastery')
      const body: unknown = await response.json()
      if (!response.ok || !isRecord(body) || body.success !== true || !Array.isArray(body.data)) throw new Error('Updated mastery could not be loaded.')
      const mastery = body.data.filter(isRecord)
      // Header stats count graded responses, so refresh them too (best effort).
      const responses = await authFetch('/api/assessment_responses').then((res) => res.json()).then((payload: unknown) => isRecord(payload) && Array.isArray(payload.data) ? payload.data.filter(isRecord) : null).catch(() => null)
      const assessmentData = await loadAssessmentData().catch(() => null)
      setSaved((current) => ({ ...current, mastery, ...(responses && { responses }), ...(assessmentData && { assessmentSessions: assessmentData.sessions, assessmentItems: assessmentData.items }) }))
      setSampleData(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Updated mastery could not be loaded.')
    }
  }, [authFetch, loadAssessmentData])

  return { saved, setSaved, sampleData, setSampleData, dataLoading, dataError, setDataError, loadSavedData, loadAssessmentData, refreshMastery }
}
