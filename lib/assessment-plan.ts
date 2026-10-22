// Pure plan building for custom assessments (no I/O, no node APIs): shared by the picker (counts, validity) and POST /api/assessment/generate.
import { DOMAINS, findDomain, findTopic, normalizeTopicId } from '@/lib/taxonomy'

export type TopicRef = { domain_id: string; topic_id: string }
export type AssessmentMode = 'knowledge_check' | 'domain_assessment'
// `topic` is the sub-topic hint; `topic_id` is the taxonomy topic id (absent only in plans stored before the taxonomy existed).
export type Slot = { slot: number; domain_id: string; topic: string; topic_id?: string; topic_label?: string; angle: string; difficulty: number; type: 'single_answer' | 'multiple_answer' }

export const MIN_QUESTIONS = 3
export const MAX_QUESTIONS = 10
export const DEFAULT_QUESTIONS = 5
export const MAX_PER_TOPIC = 3 // with the +-8 per-answer cap this bounds one session to +-24 on any single topic
export const MAX_TOPICS = 40
export const ANGLES = ['read and predict code behavior', 'diagnose a failure from symptoms or logs', 'choose between design tradeoffs', 'spot the edge case or spec detail', 'pick the right tool or measurement', 'find the bug in a short fragment']

export const topicKey = (ref: TopicRef) => `${ref.domain_id}/${ref.topic_id}`

/** Question count actually used for `selected` topics: clamped to 3..10 and to MAX_PER_TOPIC per topic. */
export const effectiveQuestionCount = (requested: number, selected: number) => selected <= 0 ? 0 : Math.max(1, Math.min(Math.round(requested) || DEFAULT_QUESTIONS, MAX_QUESTIONS, selected * MAX_PER_TOPIC))
/** "One per topic": every selected topic once, never fewer than MIN_QUESTIONS. */
export const perTopicCount = (selected: number) => effectiveQuestionCount(Math.max(selected, MIN_QUESTIONS), selected)

export type ParsedSelection = { ok: true; topics: TopicRef[]; count: number; mode: AssessmentMode } | { ok: false; error: string }

/** Validates a request body's {topics, question_count, mode}: every id must exist in the taxonomy, duplicates collapse, caps apply. */
export function parseSelection(body: Record<string, unknown>): ParsedSelection {
  if (!Array.isArray(body.topics) || body.topics.length === 0) return { ok: false, error: 'topics must be a non-empty array of {domain_id, topic_id}' }
  if (body.topics.length > MAX_TOPICS * 2) return { ok: false, error: `Select at most ${MAX_TOPICS} topics` }
  const seen = new Set<string>()
  const topics: TopicRef[] = []
  for (const entry of body.topics) {
    const domain = typeof (entry as TopicRef)?.domain_id === 'string' ? (entry as TopicRef).domain_id : ''
    const raw = typeof (entry as TopicRef)?.topic_id === 'string' ? (entry as TopicRef).topic_id : ''
    const topicId = findDomain(domain) ? normalizeTopicId(domain, raw) : null
    if (!topicId) return { ok: false, error: `Unknown topic: ${domain || '?'}/${raw || '?'}` }
    const key = `${domain}/${topicId}`
    if (!seen.has(key)) { seen.add(key); topics.push({ domain_id: domain, topic_id: topicId }) }
  }
  if (topics.length > MAX_TOPICS) return { ok: false, error: `Select at most ${MAX_TOPICS} topics` }
  const mode = body.mode === undefined ? 'knowledge_check' : body.mode
  if (mode !== 'knowledge_check' && mode !== 'domain_assessment') return { ok: false, error: 'mode must be knowledge_check or domain_assessment' }
  if (mode === 'domain_assessment' && new Set(topics.map((topic) => topic.domain_id)).size !== 1) return { ok: false, error: 'A domain assessment covers topics of exactly one domain' }
  const requested = body.question_count === undefined ? perTopicCount(topics.length) : Number(body.question_count)
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_QUESTIONS) return { ok: false, error: `question_count must be a whole number from 1 to ${MAX_QUESTIONS}` }
  return { ok: true, topics, count: effectiveQuestionCount(requested, topics.length), mode }
}

/** Taxonomy order (domain, then learning order), so a plan reads the same way as the picker. */
const taxonomyRank = (() => { const rank = new Map<string, number>(); let n = 0; for (const domain of DOMAINS) for (const topic of domain.topics) rank.set(`${domain.id}/${topic.id}`, n++); return rank })()

/** Which topic each question covers: every topic once (weakest first when there are more topics than questions), then extra rounds weakest first, at most MAX_PER_TOPIC each.
 *  `scores`: current mastery per "domain/topic" (missing = never assessed = weakest). */
export function allocateTopics(topics: TopicRef[], count: number, scores: Record<string, number>, random: () => number = Math.random): TopicRef[] {
  const weakness = (ref: TopicRef) => scores[topicKey(ref)] ?? -1
  const byWeakness = topics.map((ref) => ({ ref, tie: random() })).sort((a, b) => weakness(a.ref) - weakness(b.ref) || a.tie - b.tie).map((entry) => entry.ref)
  const total = effectiveQuestionCount(count, topics.length)
  const chosen = new Map<string, number>()
  let remaining = total
  for (let round = 0; round < MAX_PER_TOPIC && remaining > 0; round += 1) {
    for (const ref of byWeakness) { if (remaining <= 0) break; chosen.set(topicKey(ref), (chosen.get(topicKey(ref)) ?? 0) + 1); remaining -= 1 }
  }
  // Slot order: first one question of every chosen topic in taxonomy order, then the repeats, so neighbours are different topics.
  const ordered = [...chosen.keys()].sort((a, b) => (taxonomyRank.get(a) ?? 0) - (taxonomyRank.get(b) ?? 0))
  const out: TopicRef[] = []
  for (let round = 0; round < MAX_PER_TOPIC; round += 1) for (const key of ordered) if ((chosen.get(key) ?? 0) > round) { const [domain_id, topic_id] = key.split('/'); out.push({ domain_id, topic_id }) }
  return out
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]] }
  return copy
}

/** Full slot plan: one Slot per question with the real taxonomy ids, distinct sub-topics per topic, rising difficulty for repeats of one topic. */
export function buildCustomPlan(topics: TopicRef[], count: number, scores: Record<string, number>, random: () => number = Math.random): Slot[] {
  const allocation = allocateTopics(topics, count, scores, random)
  const angles = shuffled(ANGLES, random)
  const subtopics = new Map<string, string[]>()
  const seen = new Map<string, number>()
  return allocation.map((ref, index) => {
    const topic = findTopic(ref.domain_id, ref.topic_id)!
    const key = topicKey(ref)
    if (!subtopics.has(key)) subtopics.set(key, shuffled(topic.subtopics, random))
    const nth = seen.get(key) ?? 0
    seen.set(key, nth + 1)
    const pool = subtopics.get(key)!
    const score = scores[key]
    const base = score === undefined || score < 40 ? 2 : 3 // never assessed or weak: start easier; assessed above 40: start at intermediate
    return {
      slot: index, domain_id: ref.domain_id, topic: pool[nth % pool.length], topic_id: topic.id, topic_label: topic.label,
      angle: angles[index % angles.length], difficulty: Math.min(4, base + nth), type: random() < 0.2 ? 'multiple_answer' : 'single_answer',
    }
  })
}
