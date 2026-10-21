// Regenerates scripts/cleanup-topic-mastery.sql from lib/taxonomy.ts (the single source of truth).
// Usage: npx tsx scripts/gen-cleanup-topic-mastery.ts
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DOMAINS } from '../lib/taxonomy'

const pairs = DOMAINS.flatMap((domain) => domain.topics.map((topic) => [domain.id, topic.id] as const))
const lit = (value: string) => `'${value.replaceAll("'", "''")}'`
const values = pairs.map(([domainId, topicId]) => `    (${lit(domainId)}, ${lit(topicId)})`).join(',\n')
const cte = `WITH valid(domain_id, topic_id) AS (VALUES\n${values}\n)`

const sqlText = `-- GENERATED FILE - do not edit by hand. Regenerate with: npx tsx scripts/gen-cleanup-topic-mastery.ts
-- One-off, idempotent cleanup: remove topic_mastery rows whose (domain_id, topic_id) is not in lib/taxonomy.ts (${pairs.length} topics).
-- Not run automatically. Review the SELECT preview first, then run the DELETE (e.g. psql "$DATABASE_URL" -f scripts/cleanup-topic-mastery.sql).
-- Regenerate whenever lib/taxonomy.ts changes.

-- Preview: rows that the DELETE below would remove.
${cte}
SELECT m.* FROM topic_mastery m
WHERE NOT EXISTS (SELECT 1 FROM valid v WHERE v.domain_id = m.domain_id AND v.topic_id = m.topic_id);

-- Delete the rows listed above.
${cte}
DELETE FROM topic_mastery m
WHERE NOT EXISTS (SELECT 1 FROM valid v WHERE v.domain_id = m.domain_id AND v.topic_id = m.topic_id);
`
writeFileSync(join(__dirname, 'cleanup-topic-mastery.sql'), sqlText)
console.log(`wrote cleanup-topic-mastery.sql with ${pairs.length} topics`)
