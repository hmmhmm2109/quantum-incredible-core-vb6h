// Multi-topic code practice: pure helpers shared by the server (/api/lesson, part 'practice' with `topics`), the client and scripts/check-practice-multi.ts.
//
// Two modes (chosen on the Home "Code practice" card / topic picker):
//  - integrated: ONE exercise that uses all 2-4 selected topics. Cached in topic_lessons under the FIRST selected topic in taxonomy order,
//    kind `multi:<hash>` (exercise 1) / `multi:<hash>:<n>` (later ones). The kind never starts with `practice`, so a single-topic
//    lookup (`practice`, `practice:<n>`) never sees it and lecture regeneration (which deletes `practice:%`) leaves it alone.
//  - per-topic: a client-side queue of the existing single-topic exercises, one after the other (no new server code).
import { DOMAINS, findTopic } from './taxonomy'

export type TopicRef = { domain_id: string; topic_id: string }
export type PracticeMode = 'integrated' | 'per-topic'
export type PracticeQueue = { topics: TopicRef[]; index: number }

export const MIN_MULTI_TOPICS = 2
export const MAX_MULTI_TOPICS = 4

export const refKey = (ref: TopicRef) => `${ref.domain_id}/${ref.topic_id}`
export const refOfKey = (key: string): TopicRef => { const slash = key.indexOf('/'); return { domain_id: key.slice(0, slash), topic_id: key.slice(slash + 1) } }

const taxonomyOrder = new Map<string, number>(DOMAINS.flatMap((domain, d) => domain.topics.map((topic, t) => [`${domain.id}/${topic.id}`, d * 1000 + t] as const)))

/** Taxonomy order (domain, then learning order): the canonical order of a selection, whatever order it was picked in. */
export const canonicalTopics = (refs: TopicRef[]): TopicRef[] => [...refs].sort((a, b) => (taxonomyOrder.get(refKey(a)) ?? 1e9) - (taxonomyOrder.get(refKey(b)) ?? 1e9))

/** 2-4 unique valid taxonomy topics, otherwise a message for the HTTP 400. Returns them in canonical order. */
export function parseMultiTopics(raw: unknown): { ok: true; topics: TopicRef[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'topics must be an array of { domain_id, topic_id }' }
  if (raw.length < MIN_MULTI_TOPICS || raw.length > MAX_MULTI_TOPICS) return { ok: false, error: `topics must contain ${MIN_MULTI_TOPICS} to ${MAX_MULTI_TOPICS} topics` }
  const seen = new Set<string>()
  const refs: TopicRef[] = []
  for (const entry of raw) {
    const item = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>
    const ref = { domain_id: String(item.domain_id ?? ''), topic_id: String(item.topic_id ?? '') }
    if (!findTopic(ref.domain_id, ref.topic_id)) return { ok: false, error: `Unknown topic: ${ref.domain_id}/${ref.topic_id}` }
    if (seen.has(refKey(ref))) return { ok: false, error: `Duplicate topic: ${refKey(ref)}` }
    seen.add(refKey(ref)); refs.push(ref)
  }
  return { ok: true, topics: canonicalTopics(refs) }
}

// cyrb53, 14 hex chars. Not cryptographic: it only names a set of topics (order independent), 53 bits is plenty for that.
function cyrb53(text: string, seed = 0) {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i += 1) { const ch = text.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}
/** Same hash for the same SET of topics, in any order. */
export const multiHash = (refs: TopicRef[]) => cyrb53([...refs.map(refKey)].sort().join('+')).toString(16).padStart(14, '0')

export const multiKind = (hash: string, exercise: number) => exercise <= 1 ? `multi:${hash}` : `multi:${hash}:${exercise}`
/** Exercise number of a `multi:<hash>[:n]` kind of this hash, 0 when the kind belongs to something else. */
export function multiNumber(kind: string, hash: string) {
  if (kind === `multi:${hash}`) return 1
  const match = /^multi:([0-9a-f]+):(\d+)$/.exec(kind)
  return match && match[1] === hash ? Number(match[2]) : 0
}

export const multiActivityId = (hash: string, exercise: number) => exercise <= 1 ? `lesson-multi-${hash}` : `lesson-multi-${hash}-p${exercise}`
export function parseMultiActivityId(activityId: string): { hash: string; exercise: number } | null {
  const match = /^lesson-multi-([0-9a-f]{14})(?:-p(\d+))?$/.exec(activityId)
  return match ? { hash: match[1], exercise: match[2] ? Number(match[2]) : 1 } : null
}

export const multiTitle = (labels: string[]) => `Multi-topic: ${labels.join(' + ')}`

/** Rows kept in the attempt (feedback.topics) so History and Home can show every topic of a multi-topic exercise. */
export function topicsFromStored(raw: unknown): TopicRef[] {
  if (!Array.isArray(raw)) return []
  const out: TopicRef[] = []
  for (const entry of raw) {
    const item = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>
    const ref = { domain_id: String(item.domain_id ?? ''), topic_id: String(item.topic_id ?? '') }
    if (findTopic(ref.domain_id, ref.topic_id) && !out.some((other) => refKey(other) === refKey(ref))) out.push(ref)
  }
  return out
}

// ---- per-topic queue ----
export const makeQueue = (refs: TopicRef[]): PracticeQueue => ({ topics: refs, index: 0 })
/** The queue step after the exercise of `current` (a topic key), or null when `current` is the last one or not in the queue. */
export function queueAfter(queue: PracticeQueue | null, current: string): { index: number; total: number; ref: TopicRef; label: string } | null {
  if (!queue) return null
  const at = queue.topics.findIndex((ref) => refKey(ref) === current)
  if (at < 0 || at >= queue.topics.length - 1) return null
  return { index: at + 1, total: queue.topics.length, ref: queue.topics[at + 1], label: `Next topic exercise (${at + 2} of ${queue.topics.length})` }
}
export function sanitizeQueue(raw: unknown): PracticeQueue | null {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const topics = topicsFromStored(value.topics)
  if (topics.length < MIN_MULTI_TOPICS || topics.length > MAX_MULTI_TOPICS) return null
  return { topics, index: Math.min(Math.max(Math.trunc(Number(value.index) || 0), 0), topics.length - 1) }
}
