// Topic picker options shared by the Home screen and the /api/lesson route. Derived from lib/taxonomy.ts.
import { DOMAINS, topicLabel } from '@/lib/taxonomy'

export const DOMAIN_TOPIC_OPTIONS = DOMAINS.map((domain) => ({ id: domain.id, label: domain.label, topics: domain.topics.map(({ id, label }) => ({ id, label })) }))

export { topicLabel }
