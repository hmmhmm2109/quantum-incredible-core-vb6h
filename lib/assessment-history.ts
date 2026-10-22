// Pure helpers for the assessment history (no I/O): used by GET /api/assessment/history, GET /api/assessment/session and the History UI.
import { findDomain, findTopic } from '@/lib/taxonomy'

export type HistorySelection = 'topic' | 'custom' | 'diagnostic' | 'retake'
export type HistoryTopic = { domain_id: string; topic_id: string; name: string }
export type Outcome = 'correct' | 'partial' | 'incorrect'
export type MasteryChange = { domain_id: string; topic_id: string; name: string; from_band: string | null; to_band: string | null; from_score: number | null; to_score: number | null; delta: number }
export type HistorySession = {
  session_id: string; mode: string; selection: HistorySelection; topics: HistoryTopic[]; title: string
  status: 'in_progress' | 'completed' | 'abandoned'; started_at: string; completed_at: string | null
  question_count: number; answered_count: number; correct_count: number; score_pct: number | null
  mastery_changes: MasteryChange[]; retake_of: string | null
}

/** Mode of a session that re-presents the questions of an earlier one: graded, but it never moves mastery. */
export const RETAKE_MODE = 'review_retake'

type Coverage = { domain_id?: unknown; topic_id?: unknown }
const text = (value: unknown) => (typeof value === 'string' ? value : '')

export const topicName = (domainId: string, topicId: string) => findTopic(domainId, topicId)?.label ?? topicId

/** Unique topics of a session in plan order. */
export function topicsOf(coverage: unknown): HistoryTopic[] {
  const seen = new Set<string>()
  const out: HistoryTopic[] = []
  for (const entry of Array.isArray(coverage) ? (coverage as Coverage[]) : []) {
    const domain_id = text(entry?.domain_id)
    const topic_id = text(entry?.topic_id)
    if (!domain_id || !topic_id || seen.has(`${domain_id}/${topic_id}`)) continue
    seen.add(`${domain_id}/${topic_id}`)
    out.push({ domain_id, topic_id, name: topicName(domain_id, topic_id) })
  }
  return out
}

/** timing_policy.selection when present ('custom' | 'retake'); older sessions are inferred from the plan: one topic -> 'topic', one topic in each of several domains -> 'diagnostic'. */
export function deriveSelection(mode: string, timingPolicy: unknown, topics: HistoryTopic[]): HistorySelection {
  const stored = text((timingPolicy as { selection?: unknown } | null)?.selection)
  if (mode === RETAKE_MODE || stored === 'retake') return 'retake'
  if (stored === 'custom') return 'custom'
  if (topics.length === 1) return 'topic'
  const domains = new Set(topics.map((topic) => topic.domain_id))
  if (topics.length > 1 && domains.size === topics.length) return 'diagnostic'
  return 'custom'
}

export function sessionTitle(mode: string, selection: HistorySelection, topics: HistoryTopic[]): string {
  const names = topics.map((topic) => topic.name)
  const list = names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`
  const prefix = selection === 'retake' ? 'Retry: ' : ''
  if (selection === 'diagnostic') return `${prefix}Mixed diagnostic`
  if (mode === 'domain_assessment' && topics[0]) return `${prefix}Domain: ${findDomain(topics[0].domain_id)?.label ?? topics[0].domain_id}`
  return `${prefix}${list || 'Assessment'}`
}

export const outcomeOf = (partialCredit: number): Outcome => (partialCredit >= 1 ? 'correct' : partialCredit > 0 ? 'partial' : 'incorrect')

export const normalizeStatus = (status: string): HistorySession['status'] => (status === 'completed' ? 'completed' : status === 'abandoned' ? 'abandoned' : 'in_progress')

/** A session counts as an assessment only when it was planned (seed placeholders with an empty plan and no answers are not). */
export const planLength = (timingPolicy: unknown) => ((timingPolicy as { plan?: unknown[] } | null)?.plan ?? []).length
