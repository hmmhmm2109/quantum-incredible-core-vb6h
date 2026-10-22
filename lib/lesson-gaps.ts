// Learner questions about a lesson are stored as learning_events rows (event_type 'question', score/confidence deltas 0),
// so no migration is needed. `evidence` carries the Q&A and the knowledge gap Claude noted.
export const QUESTION_EVENT = 'question'
export const ADAPT_MAX_GAPS = 12
export const ADAPTED_KIND = 'lecture:adapted'

export type QuestionEvidence = {
  kind: 'lesson_question'
  variant: string | null // lecture variant the question was asked on (null = the base lecture)
  section_index: number | null // null = a general question about the lesson
  section_title: string | null
  question: string
  answer: string
  gap: { is_gap: boolean; summary: string; missing_prerequisite: string | null }
  suggested_rewrite: boolean
  served_by?: string // model label of the provider that actually answered (differs from the setting after a failover)
  resolved: boolean // true once an adapted lecture was written from this gap (kept for backward compatibility; folded_at is the precise marker); Regenerate re-opens it
  resolved_at?: string
  folded_at?: string // set when the gap was woven into the enriched lecture (cleared by Regenerate)
  folded_into?: string // cache kind it was folded into ('lecture:adapted')
}

export const asEvidence = (value: unknown) => value as Partial<QuestionEvidence>

// Any noted knowledge gap, folded or not.
export const isGapEvent = (value: unknown) => asEvidence(value).gap?.is_gap === true
// A gap the enriched lecture does not contain yet.
export const isNewGap = (value: unknown) => isGapEvent(value) && !asEvidence(value).folded_at && asEvidence(value).resolved !== true

// Stored next to `lecture` in the topic_lessons content of the enriched lecture.
export type AdaptedMeta = { gap_hash: string; folded_gap_ids: string[]; adapted_at: string }

export type AdaptState = { has_adapted: boolean; new_gap_count: number; adapted_stale: boolean; folded_count: number }

/** Newest-first rows -> the gaps the enriched lecture is built from (newest ADAPT_MAX_GAPS), their count beyond the cap, and the staleness verdict.
 *  Stale = the enriched lecture was built from a different set of gaps. A legacy enriched lecture (no meta) is stale only while unfolded gaps exist. */
export function adaptState(rows: { id: string; evidence: unknown }[], adapted: { _meta?: Partial<AdaptedMeta> } | null, hashOf: (ids: string[]) => string) {
  const all = rows.filter((row) => isGapEvent(row.evidence))
  const gaps = all.slice(0, ADAPT_MAX_GAPS)
  const newCount = all.filter((row) => isNewGap(row.evidence)).length
  const hash = hashOf(gaps.map((row) => row.id))
  const meta = adapted?._meta
  const stale = !adapted ? false : meta?.gap_hash ? meta.gap_hash !== hash : newCount > 0
  const state: AdaptState = { has_adapted: Boolean(adapted), new_gap_count: newCount, adapted_stale: stale, folded_count: meta?.folded_gap_ids?.length ?? 0 }
  return { gaps, truncated: all.length - gaps.length, hash, state }
}
