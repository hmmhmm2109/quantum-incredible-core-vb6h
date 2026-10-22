// Shared types for the single-page app (app/page.tsx and its hooks/helpers).

export const CLAUDE_RUNTIME = 'claude-cli-oauth'

export type ViewName = 'home' | 'practice' | 'assessment' | 'review' | 'lesson' | 'skill-map' | 'history' | 'profile'
export type JsonRecord = Record<string, unknown>

export type SavedState = {
  profile: JsonRecord | null
  mastery: JsonRecord[]
  activities: JsonRecord[]
  attempts: JsonRecord[]
  recommendations: JsonRecord[]
  assessmentSessions: JsonRecord[]
  assessmentItems: JsonRecord[]
  responses: JsonRecord[]
}

export type ClaudeState = {
  available: boolean
  status: string
  notice: string
  job_id: string | null
  exit_code: number | null
  stdout: string
  stderr: string
  changed_files: { path: string; change: string }[]
}

export type LessonState = { domainId: string; topicId: string; status: 'loading' | 'ready' | 'error'; error: string | null; variant: string | null; practice: 'idle' | 'loading' | 'ready' | 'error'; busy: boolean }
export const LESSON_VARIANTS: Record<string, string> = { shorter: 'Shorter version', 'another-example': 'Another example', prerequisites: 'Prerequisites refresher', adapt: 'Enriched with your questions' }

export type GeneratedAssessment = { sessionId: string; total: number; items: JsonRecord[]; coverage: { domain_id: string; topic_id: string; weight: number; subtopic?: string }[]; pending: number; missing: { slot: number; reason: string }[] }
