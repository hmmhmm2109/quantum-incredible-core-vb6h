// Whole-domain scoring. Pure (no UI or DB imports) so it can be checked with `npx tsx scripts/check-domain-score.ts`.
//
// Definition: domain_score = round(mean of topic scores over ALL topics of the domain), weight 1 per topic.
// A topic that is not assessed (no row, awaiting_diagnostic placeholder, learned-only) counts as 0.
// Band thresholds match topics: < 40 Basic, < 70 Intermediate, otherwise Advanced. No assessed topic -> 'Not started'.
// Overall level = same mean over every topic of every domain (topic-count weighted), not a mean of domain scores.

export type TopicScoreInput = { score: unknown; assessed: boolean }
export type DomainScore = {
  score: number
  level: 'Not started' | 'Basic' | 'Intermediate' | 'Advanced'
  assessedCount: number
  totalCount: number
  /** Mean over assessed topics only (secondary metric); null when none are assessed. */
  assessedAverage: number | null
  coverage: number
  /** True when fewer than half of the topics are assessed: the level is still moving. */
  provisional: boolean
  /** Index into the input of the lowest-scoring assessed topic, or -1. */
  weakestIndex: number
}

export const PROVISIONAL_COVERAGE = 0.5

export function bandForScore(score: number): 'Basic' | 'Intermediate' | 'Advanced' {
  return score >= 70 ? 'Advanced' : score >= 40 ? 'Intermediate' : 'Basic'
}

// Scores may arrive as numeric strings (Postgres numeric columns); anything non-finite counts as 0, and values are clamped to 0..100.
export function toScore(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : 0
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
}

export function aggregateDomain(topics: TopicScoreInput[]): DomainScore {
  const totalCount = topics.length
  const scores = topics.map((topic) => (topic.assessed ? toScore(topic.score) : 0))
  const assessedIdx = topics.map((topic, index) => (topic.assessed ? index : -1)).filter((index) => index >= 0)
  const score = totalCount > 0 ? Math.round(scores.reduce((sum, value) => sum + value, 0) / totalCount) : 0
  const assessedAverage = assessedIdx.length > 0 ? Math.round(assessedIdx.reduce((sum, index) => sum + scores[index], 0) / assessedIdx.length) : null
  const weakestIndex = assessedIdx.reduce((best, index) => (best < 0 || scores[index] < scores[best] ? index : best), -1)
  const coverage = totalCount > 0 ? assessedIdx.length / totalCount : 0
  return { score, level: assessedIdx.length > 0 ? bandForScore(score) : 'Not started', assessedCount: assessedIdx.length, totalCount, assessedAverage, coverage, provisional: assessedIdx.length > 0 && coverage < PROVISIONAL_COVERAGE, weakestIndex }
}

/** Overall across domains: mean over every topic (topic-count weighted). */
export function aggregateOverall(domains: TopicScoreInput[][]): DomainScore {
  return aggregateDomain(domains.flat())
}
