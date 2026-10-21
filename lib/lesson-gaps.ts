// Learner questions about a lesson are stored as learning_events rows (event_type 'question', score/confidence deltas 0),
// so no migration is needed. `evidence` carries the Q&A and the knowledge gap Claude noted.
export const QUESTION_EVENT = 'question'
export const ADAPT_MAX_GAPS = 8

export type QuestionEvidence = {
  kind: 'lesson_question'
  variant: string | null // lecture variant the question was asked on (null = the base lecture)
  section_index: number | null // null = a general question about the lesson
  section_title: string | null
  question: string
  answer: string
  gap: { is_gap: boolean; summary: string; missing_prerequisite: string | null }
  suggested_rewrite: boolean
  resolved: boolean // true once an adapted lecture was written from this gap; Regenerate re-opens it
  resolved_at?: string
}

export const asEvidence = (value: unknown) => value as Partial<QuestionEvidence>
// A gap still waiting to be folded into the adapted lecture.
export const isOpenGap = (value: unknown) => { const evidence = asEvidence(value); return evidence.gap?.is_gap === true && evidence.resolved !== true }
