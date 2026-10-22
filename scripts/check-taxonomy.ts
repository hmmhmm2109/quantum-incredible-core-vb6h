// Deliberate project check: npx tsx scripts/check-taxonomy.ts (run from the repo root, needs git for the id comparison).
import { execSync } from 'node:child_process'
import { DOMAINS } from '../lib/taxonomy'

const EXPECTED: Record<string, number> = { c: 11, cpp: 12, linux: 13, networking: 17, bsp: 15, qnx: 15, patterns: 15 }
const failures: string[] = []
const check = (ok: boolean, message: string) => { if (!ok) failures.push(message) }

check(DOMAINS.length === 7, `expected 7 domains, got ${DOMAINS.length}`)
check(DOMAINS.reduce((sum, d) => sum + d.topics.length, 0) === 98, 'expected 98 topics in total')
check(new Set(DOMAINS.map((d) => d.id)).size === DOMAINS.length, 'duplicate domain ids')
for (const d of DOMAINS) {
  check(d.topics.length === EXPECTED[d.id], `${d.id}: expected ${EXPECTED[d.id]} topics, got ${d.topics.length}`)
  check(new Set(d.topics.map((t) => t.id)).size === d.topics.length, `${d.id}: duplicate topic ids`)
  d.topics.forEach((t, index) => {
    check(t.order === index + 1, `${d.id}/${t.id}: order ${t.order} != ${index + 1}`)
    check(t.subtopics.length === 4 && t.subtopics.every((s) => s.trim().length > 0), `${d.id}/${t.id}: needs 4 non-empty subtopics`)
    if (index === 0) check(!t.prerequisites?.length, `${d.id}/${t.id}: first topic must have no prerequisites`)
    for (const p of t.prerequisites ?? []) {
      const at = d.topics.findIndex((x) => x.id === p)
      check(at >= 0 && at < index, `${d.id}/${t.id}: prerequisite ${p} must be an earlier topic of the same domain`)
    }
  })
}

// Ids must never be renamed or removed: compare with the committed baseline (HEAD), when it differs from the working tree.
try {
  const previous = execSync('git show HEAD:lib/taxonomy.ts', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const old = new Set<string>()
  let current = ''
  for (const line of previous.split('\n')) {
    const d = line.match(/^\s*domain\('([a-z0-9-]+)'/)
    if (d) current = d[1]
    const t = line.match(/^\s*\['([a-z0-9-]+)', '/)
    if (t && current) old.add(`${current}/${t[1]}`)
  }
  const now = new Set(DOMAINS.flatMap((d) => d.topics.map((t) => `${d.id}/${t.id}`)))
  const missing = [...old].filter((id) => !now.has(id))
  check(missing.length === 0, `ids missing vs HEAD: ${missing.join(', ')}`)
  console.log(`baseline ids at HEAD: ${old.size}, still present: ${old.size - missing.length}`)
} catch { console.log('baseline comparison skipped (no git HEAD)') }

if (failures.length > 0) { console.error(failures.join('\n')); process.exit(1) }
console.log(`taxonomy ok: ${DOMAINS.length} domains, ${DOMAINS.reduce((s, d) => s + d.topics.length, 0)} topics (${DOMAINS.map((d) => `${d.id} ${d.topics.length}`).join(', ')})`)
