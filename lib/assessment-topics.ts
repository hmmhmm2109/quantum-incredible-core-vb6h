// Helpers the server uses to draw a (topic, sub-topic) per question so every generated assessment covers
// different ground. The question text itself is written by Claude; the topics come from lib/taxonomy.ts.
import { DOMAINS } from '@/lib/taxonomy'

// Flat sub-topic hints per domain, kept for callers that only need free text.
export const DOMAIN_TOPICS: Record<string, string[]> = Object.fromEntries(DOMAINS.map((domain) => [domain.id, domain.topics.flatMap((topic) => topic.subtopics)]))

export const DOMAIN_ORDER: readonly string[] = DOMAINS.map((domain) => domain.id)

import { randomInt } from 'node:crypto'

export function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)]
}

export function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
