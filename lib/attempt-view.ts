// One formatter for saved code attempts, shared by Home "Recent code attempts" and the History tab.
// Old rows (before max_score/passed/title were stored) degrade gracefully: unknown outcome shows as "Submitted", never "Passed".
import { DOMAINS, findDomain, findTopic } from './taxonomy'
import { multiTitle, parseMultiActivityId, topicsFromStored, type TopicRef } from './practice-multi'

type Rec = Record<string, unknown>
const rec = (value: unknown): Rec => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Rec : {})
const str = (value: unknown) => (typeof value === 'string' ? value : '')
const num = (value: unknown): number | null => { const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN; return Number.isFinite(n) ? n : null }

export type AttemptTone = 'good' | 'warn' | 'neutral'
export type AttemptView = {
  id: string; title: string; chip: string; meta: string; status: string; tone: AttemptTone; scoreLabel: string | null
  when: string; whenFull: string; domainId: string | null; topicId: string | null; exercise: number | null
  /** Every topic of a multi-topic exercise (chips); empty for single-topic attempts. */
  topics: { domainId: string; topicId: string; label: string; domainLabel: string }[]
  multi: boolean
}

/** Topics stored with a multi-topic attempt (feedback.topics, copied to execution_result.topics), as labelled refs. */
export function attemptTopics(attempt: Rec): { ref: TopicRef; label: string; domainLabel: string }[] {
  const stored = topicsFromStored(rec(attempt.feedback).topics).concat(topicsFromStored(rec(attempt.execution_result).topics))
  const refs = stored.filter((ref, index) => stored.findIndex((other) => other.domain_id === ref.domain_id && other.topic_id === ref.topic_id) === index)
  return refs.map((ref) => ({ ref, label: findTopic(ref.domain_id, ref.topic_id)?.label ?? ref.topic_id, domainLabel: findDomain(ref.domain_id)?.label ?? ref.domain_id }))
}

/** 'lesson-<domain>-<topic>[-pN][:transfer]' -> taxonomy ids and exercise number (null for ids that are not a practice exercise). */
export function parseActivityId(activityId: string) {
  const transfer = activityId.endsWith(':transfer')
  const base = transfer ? activityId.slice(0, -':transfer'.length) : activityId
  if (!base.startsWith('lesson-')) return null
  const rest = base.slice('lesson-'.length)
  for (const domain of DOMAINS) {
    if (!rest.startsWith(`${domain.id}-`)) continue
    const tail = rest.slice(domain.id.length + 1)
    const suffix = /^(.*)-p(\d+)$/.exec(tail)
    for (const [topicPart, exercise] of suffix ? [[suffix[1], Number(suffix[2])], [tail, 1]] as const : [[tail, 1]] as const) {
      const topic = domain.topics.find((entry) => entry.id === topicPart)
      if (topic) return { domainId: domain.id, domainLabel: domain.label, topicId: topic.id, topicLabel: topic.label, exercise: transfer ? null : exercise, transfer }
    }
  }
  return null
}

/** First sentence of the activity summary, if it is short enough to be a name ("Complete the Makefile."); otherwise null. */
export function shortActivityTitle(summary: unknown): string | null {
  const text = str(summary).replace(/\s+/g, ' ').trim()
  if (!text || /^activity response\.?$/i.test(text)) return null
  const first = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text
  const title = first.replace(/[.!?]+$/, '').trim()
  return title.length >= 3 && title.length <= 70 ? title : null
}

export function relativeTime(iso: string, now = Date.now()): { short: string; full: string } {
  const time = new Date(iso).getTime()
  if (!iso || Number.isNaN(time)) return { short: 'Unknown date', full: '' }
  const full = new Date(time).toLocaleString()
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  if (seconds < 60) return { short: 'just now', full }
  if (seconds < 3600) return { short: `${Math.round(seconds / 60)} min ago`, full }
  if (seconds < 86400) return { short: `${Math.round(seconds / 3600)} h ago`, full }
  if (seconds < 7 * 86400) return { short: `${Math.round(seconds / 86400)} d ago`, full }
  return { short: new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), full }
}

/** Real graded outcome of an attempt row. */
export function attemptResult(attempt: Rec): { status: string; tone: AttemptTone; scoreLabel: string | null } {
  const feedback = rec(attempt.feedback)
  const exec = rec(attempt.execution_result)
  if (str(attempt.completion_state) === 'draft' || feedback.state === 'draft') return { status: 'Draft', tone: 'neutral', scoreLabel: null }
  const score = num(attempt.score)
  // Transfer exercises store a 0-100 score and an explicit verdict.
  const verdict = str(feedback.verdict)
  if (verdict) {
    const label = score !== null ? `${Math.round(score)}/100` : null
    return verdict === 'correct' ? { status: 'Passed', tone: 'good', scoreLabel: label } : verdict === 'partial' ? { status: 'Partial', tone: 'warn', scoreLabel: label } : { status: 'Needs work', tone: 'warn', scoreLabel: label }
  }
  const max = num(feedback.max_score) ?? num(exec.max_score)
  if (score !== null && max !== null && max > 0) {
    const label = `${Number(score.toFixed(2))}/${Number(max.toFixed(2))}`
    if (score >= max) return { status: 'Passed', tone: 'good', scoreLabel: label }
    return score > 0 ? { status: 'Partial', tone: 'warn', scoreLabel: label } : { status: 'Needs work', tone: 'warn', scoreLabel: label }
  }
  // Legacy row: no max_score stored, so a positive score cannot be judged; only an explicit zero is a known miss.
  if (score !== null && score <= 0) return { status: 'Needs work', tone: 'warn', scoreLabel: null }
  return { status: 'Submitted', tone: 'neutral', scoreLabel: null }
}

export function attemptView(attempt: Rec, index = 0, now = Date.now()): AttemptView {
  const feedback = rec(attempt.feedback)
  const multiId = parseMultiActivityId(str(attempt.activity_id))
  const multiTopics = multiId ? attemptTopics(attempt) : []
  const parsed = multiId ? null : parseActivityId(str(attempt.activity_id))
  const result = attemptResult(attempt)
  const exercise = multiId ? multiId.exercise : parsed?.exercise ?? null
  const named = str(feedback.title).trim() || shortActivityTitle(feedback.domain)
  const multiTitleText = multiTopics.length > 0 ? multiTitle(multiTopics.map((entry) => entry.label)) : 'Multi-topic exercise'
  const fallback = multiId ? multiTitleText : parsed ? (parsed.transfer ? `${parsed.topicLabel} · Transfer exercise` : `${parsed.topicLabel} · Exercise ${exercise}`) : 'Practice attempt'
  const hints = num(attempt.hint_count) ?? 0
  const when = relativeTime(str(attempt.created_at), now)
  const parts = [multiId ? `Exercise ${exercise}` : parsed ? (parsed.transfer ? 'Transfer exercise' : `Exercise ${exercise}`) : 'Code exercise', hints > 0 ? `${hints} hint${hints === 1 ? '' : 's'}` : ''].filter(Boolean)
  return {
    id: str(attempt.id) || `attempt-${index + 1}`,
    title: multiId ? multiTitleText : named || fallback,
    chip: multiId ? (multiTopics.length > 0 ? multiTopics.map((entry) => entry.label).join(' · ') : 'Several topics') : parsed ? `${parsed.domainLabel} · ${parsed.topicLabel}` : 'Embedded systems',
    meta: parts.join(' · '), status: result.status, tone: result.tone, scoreLabel: result.scoreLabel,
    when: when.short, whenFull: when.full, domainId: multiId ? multiTopics[0]?.ref.domain_id ?? null : parsed?.domainId ?? null, topicId: multiId ? multiTopics[0]?.ref.topic_id ?? null : parsed?.topicId ?? null, exercise,
    topics: multiTopics.map((entry) => ({ domainId: entry.ref.domain_id, topicId: entry.ref.topic_id, label: entry.label, domainLabel: entry.domainLabel })), multi: Boolean(multiId),
  }
}
