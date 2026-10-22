import type { HomeAttempt, HomeDomain, HomeRecommendation } from '@/app/sections/home-section'
import type { SkillDomain, SkillTopic } from '@/app/sections/skill-map-section'
import type { JsonRecord, SavedState } from '@/lib/app-types'
import { arrayValue, isRecord, numberValue, recordValue, stringValue } from '@/lib/normalize'
import { SAMPLE_ATTEMPTS, SAMPLE_DOMAINS, SAMPLE_RECOMMENDATION, sampleFocusTopicId } from '@/lib/sample-data'
import { DOMAINS, findDomain, findTopic } from '@/lib/taxonomy'

// Real header stats: consecutive local days (ending today or yesterday) with a graded response or attempt, and the total of both.
export function activityStats(saved: SavedState) {
  const records = [...saved.responses, ...saved.attempts]
  const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
  const days = new Set(records.map((record) => new Date(stringValue(record.created_at))).filter((date) => !Number.isNaN(date.getTime())).map(dayKey))
  const cursor = new Date()
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (days.has(dayKey(cursor))) { streak += 1; cursor.setDate(cursor.getDate() - 1) }
  return { streak, exercises: records.length }
}

// A topic_mastery row written by "Mark learned" has evidence_summary.state 'learned'; the grade route overwrites it with 'assessed'.
export const isLearnedRow = (item: JsonRecord) => recordValue(item.evidence_summary).state === 'learned'
// Home "Recommended next" for real data: assess the latest learned-but-unassessed topic, otherwise the next untouched topic in taxonomy order after the latest activity.
export function pickRecommendation(mastery: JsonRecord[]): HomeRecommendation | null {
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

export function buildHomeAttempts(sampleData: boolean, attempts: JsonRecord[]): HomeAttempt[] {
  if (sampleData) return SAMPLE_ATTEMPTS
  return attempts.map((attempt, index) => { const feedback = recordValue(attempt.feedback); return { id: stringValue(attempt.id, `attempt-${index + 1}`), title: stringValue(feedback.title, 'Embedded systems practice'), meta: `${stringValue(feedback.domain, 'Saved attempt')} · ${stringValue(feedback.format, 'Review')}`, status: stringValue(attempt.completion_state, 'Saved') === 'completed' ? 'Passed' : 'Retry', duration: `${Math.max(1, Math.round(numberValue(attempt.hint_count) + 12))} min`, isReal: true } })
}

export function buildHomeRecommendation(sampleData: boolean, mastery: JsonRecord[], recommendations: JsonRecord[]): HomeRecommendation {
  if (sampleData) return SAMPLE_RECOMMENDATION
  const picked = pickRecommendation(mastery)
  if (picked) return picked
  const record = recommendations[0]
  const metadata = recordValue(record?.activity_metadata)
  return record ? { title: stringValue(metadata.title, 'Continue your diagnostic'), description: stringValue(metadata.description, 'Use the coach to generate the next evidence-building activity.'), domain: stringValue(metadata.domain, 'Embedded systems'), topic: stringValue(metadata.topic, 'Mixed diagnostic'), level: stringValue(metadata.level_band, 'Basic'), format: stringValue(metadata.format, 'Diagnostic'), duration: numberValue(metadata.estimated_duration_minutes, 15), rationale: stringValue(record.rationale, 'The next task is selected from your current evidence.'), isReal: true } : { title: 'Start your mixed diagnostic', description: 'Answer a few varied questions so the coach can build an independent baseline for each domain.', domain: 'All domains', topic: 'Initial placement', level: 'Basic → Expert', format: 'Assessment', duration: 12, rationale: 'No saved recommendation exists yet. A diagnostic creates the evidence needed for an adaptive path.', isReal: false }
}

// Skill Map data: sample cards, or one card per taxonomy domain built from topic_mastery rows.
export function buildSkillDomains(sampleData: boolean, mastery: JsonRecord[]): SkillDomain[] {
  if (sampleData) return SAMPLE_DOMAINS.map((domain) => ({ id: domain.id, label: domain.label, level: domain.level, score: domain.score, isReal: false, topics: domain.id === 'c' ? [{ id: 'types-control-flow', label: 'Types & control flow', score: 91, level: 'Advanced', confidence: 0.91, state: 'ready', detail: 'Strong evidence from output prediction and implementation tasks.', evidence: ['Explained integer conversions in two formats.', 'Passed a control-flow repair exercise.'], prerequisite: null, isReal: false }, { id: 'pointers-bounds', label: 'Pointers & bounds', score: 64, level: 'Intermediate', confidence: 0.78, state: 'active', detail: 'Bounds checks are improving; the next exercise targets validation order.', evidence: ['Strong pointer arithmetic in the last attempt.', 'Two recent misses on truncated headers.'], prerequisite: null, isReal: false }, { id: 'memory-lifetime', label: 'Memory & lifetime', score: 55, level: 'Intermediate', confidence: 0.64, state: 'ready', detail: 'Review ownership and allocation tradeoffs before concurrency.', evidence: ['Identified one leak in a code review.'], prerequisite: null, isReal: false }, { id: 'interrupts-concurrency', label: 'Interrupts & concurrency', score: 0, level: 'Locked', confidence: 0, state: 'locked', detail: 'Complete memory prerequisites first.', evidence: [], prerequisite: 'Complete memory & lifetime', isReal: false }] : [{ id: sampleFocusTopicId(domain.id), label: domain.focus, score: domain.score, level: domain.level, confidence: domain.confidence, state: 'active', detail: `Your ${domain.label} track is ready for a focused diagnostic.`, evidence: ['Sample evidence is shown until you complete the mixed diagnostic.'], prerequisite: null, isReal: false }, { id: findDomain(domain.id)?.topics.at(-1)?.id ?? '', label: findDomain(domain.id)?.topics.at(-1)?.label ?? 'Applied diagnosis', score: Math.max(0, domain.score - 12), level: domain.level, confidence: Math.max(0.35, domain.confidence - 0.1), state: 'ready', detail: 'A related transfer task will strengthen this path.', evidence: [], prerequisite: null, isReal: false }] }))
  // One card per taxonomy domain, topics in learning order; taxonomy topics without a mastery row show as not started.
  const rows = new Map(mastery.map((item) => [`${stringValue(item.domain_id)}/${stringValue(item.topic_id)}`, item]))
  return DOMAINS.map((domain) => {
    const topics: SkillTopic[] = domain.topics.map((topic) => {
      const item = rows.get(`${domain.id}/${topic.id}`)
      if (!item) return { id: topic.id, label: topic.label, score: 0, level: 'Not started', confidence: 0, state: 'ready', detail: 'No evidence yet. Take a topic assessment to start this rating.', evidence: [], prerequisite: null, isReal: true }
      const evidenceSummary = recordValue(item.evidence_summary)
      // The account seed writes a score-0 placeholder row per domain; it is not evidence, so it must not count as an assessed topic.
      if (evidenceSummary.state === 'awaiting_diagnostic') return { id: topic.id, label: topic.label, score: 0, level: 'Not started', confidence: 0, state: 'ready', detail: 'No evidence yet. Take a topic assessment to start this rating.', evidence: [], prerequisite: null, isReal: true }
      if (isLearnedRow(item)) return { id: topic.id, label: topic.label, score: 0, level: 'Learned', confidence: 0, state: 'ready', detail: stringValue(evidenceSummary.recommended_focus, 'Learned, not assessed yet.'), evidence: [], prerequisite: null, isReal: true }
      const evidence = arrayValue(evidenceSummary.evidence).filter((line): line is string => typeof line === 'string')
      return { id: topic.id, label: topic.label, score: numberValue(item.score), level: stringValue(item.level_band, 'Basic'), confidence: numberValue(item.confidence), state: 'active', detail: stringValue(evidenceSummary.recommended_focus, 'No topic explanation has been recorded yet.'), evidence, prerequisite: null, isReal: true }
    })
    const assessed = topics.filter((topic) => topic.state === 'active')
    // Domain level = the best level the learner has shown on any assessed topic. A mean over assessed topics hid a topic that reached Intermediate behind untouched or zero-score ones.
    const score = assessed.reduce((best, topic) => Math.max(best, topic.score), 0)
    const level = assessed.length > 0 ? (score >= 70 ? 'Advanced' : score >= 40 ? 'Intermediate' : 'Basic') : 'Not started'
    return { id: domain.id, label: domain.label, level, score, isReal: true, topics }
  })
}

// Home cards reuse the per-domain grouping from skillDomains: one card per domain, level from the best assessed topic.
export function buildHomeDomains(sampleData: boolean, skillDomains: SkillDomain[]): HomeDomain[] {
  if (sampleData) return SAMPLE_DOMAINS
  return skillDomains.map((domain) => {
    const assessed = domain.topics.filter((topic) => topic.state === 'active')
    const confidence = assessed.length > 0 ? assessed.reduce((sum, topic) => sum + topic.confidence, 0) / assessed.length : 0
    return { id: domain.id, label: domain.label, score: domain.score, level: domain.level, confidence, focus: assessed[0]?.detail ?? '', caption: `${assessed.length} of ${domain.topics.length} topics assessed`, isReal: true }
  })
}

// ---- Code practice entry points on Home (the quiz flow has its own cards) ----
export type PracticeTopic = { domainId: string; topicId: string; domainLabel: string; topicLabel: string; reason: string }
export type RecentExercise = PracticeTopic & { id: string; status: 'Passed' | 'Partial' | 'Retry'; when: string; kind: 'Code exercise' | 'Transfer exercise' }

const topicRefOf = (domainId: string, topicId: string) => { const domain = findDomain(domainId); const topic = findTopic(domainId, topicId); return domain && topic ? { domainId, topicId, domainLabel: domain.label, topicLabel: topic.label } : null }

/** Topic for "Start a code exercise": the weakest assessed topic below 70, otherwise the topic touched last (a lesson was read or marked learned), otherwise null (the learner picks one). */
export function pickPracticeTopic(mastery: JsonRecord[]): PracticeTopic | null {
  const rows = mastery.filter((item) => findTopic(stringValue(item.domain_id), stringValue(item.topic_id)))
  const assessed = rows.filter((item) => recordValue(item.evidence_summary).state === 'assessed' && numberValue(item.score) < 70).sort((a, b) => numberValue(a.score) - numberValue(b.score))
  const pick = assessed[0] ?? rows.reduce<JsonRecord | undefined>((best, item) => (!best || stringValue(item.updated_at) > stringValue(best.updated_at) ? item : best), undefined)
  if (!pick) return null
  const ref = topicRefOf(stringValue(pick.domain_id), stringValue(pick.topic_id))
  if (!ref) return null
  return { ...ref, reason: assessed[0] ? `Your weakest assessed topic (${Math.round(numberValue(pick.score))}%).` : 'The topic you worked on last.' }
}

/** Attempt rows hold activity ids like "lesson-<domain>-<topic>" (optionally ":transfer"); resolve them against the taxonomy. */
export function recentExercises(attempts: JsonRecord[], limit = 4): RecentExercise[] {
  const out: RecentExercise[] = []
  for (const attempt of [...attempts].sort((a, b) => stringValue(b.created_at).localeCompare(stringValue(a.created_at)))) {
    const activityId = stringValue(attempt.activity_id)
    const match = /^lesson-(.+?)(:transfer)?$/.exec(activityId)
    if (!match) continue
    const domain = DOMAINS.find((entry) => match[1].startsWith(`${entry.id}-`))
    const topic = domain?.topics.find((entry) => match[1] === `${domain.id}-${entry.id}`)
    if (!domain || !topic) continue
    const state = stringValue(attempt.completion_state)
    out.push({ id: stringValue(attempt.id), domainId: domain.id, topicId: topic.id, domainLabel: domain.label, topicLabel: topic.label, reason: '', status: state === 'completed' ? 'Passed' : state === 'partial' ? 'Partial' : 'Retry', when: stringValue(attempt.created_at), kind: match[2] ? 'Transfer exercise' : 'Code exercise' })
    if (out.length >= limit) break
  }
  return out
}
