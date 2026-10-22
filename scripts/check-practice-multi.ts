// Run: npx tsx scripts/check-practice-multi.ts
import assert from 'node:assert/strict'
import { attemptTopics, attemptView, parseActivityId } from '../lib/attempt-view'
import { recentExercises } from '../lib/home-recommendation'
import { canonicalTopics, makeQueue, multiActivityId, multiHash, multiKind, multiNumber, multiTitle, parseMultiActivityId, parseMultiTopics, queueAfter, sanitizeQueue, topicsFromStored } from '../lib/practice-multi'

const run = (name: string, fn: () => void) => { fn(); console.log('ok  ', name) }
const A = { domain_id: 'cpp', topic_id: 'raii-lifetime' }
const B = { domain_id: 'cpp', topic_id: 'smart-pointers-ownership' }
const C = { domain_id: 'c', topic_id: 'pointers-bounds' }
const D = { domain_id: 'c', topic_id: 'bit-operations' }
const E = { domain_id: 'bsp', topic_id: 'gpio-pinmux' }

run('validation: 2-4 unique valid topics, else a message', () => {
  assert.equal(parseMultiTopics([A]).ok, false)
  assert.equal(parseMultiTopics([A, B, C, D, E]).ok, false)
  assert.equal(parseMultiTopics([A, A]).ok, false)
  assert.equal(parseMultiTopics([A, { domain_id: 'cpp', topic_id: 'nope' }]).ok, false)
  assert.equal(parseMultiTopics('x').ok, false)
  assert.equal(parseMultiTopics([A, null]).ok, false)
  const ok = parseMultiTopics([B, A])
  assert.ok(ok.ok && ok.topics.length === 2)
  assert.equal(parseMultiTopics([A, B, C, D]).ok, true)
})
run('canonical order is taxonomy order (domain, then learning order), whatever the pick order', () => {
  const ok = parseMultiTopics([B, E, C, A])
  assert.ok(ok.ok)
  if (ok.ok) assert.deepEqual(ok.topics.map((t) => `${t.domain_id}/${t.topic_id}`), canonicalTopics([A, B, C, E]).map((t) => `${t.domain_id}/${t.topic_id}`))
  assert.deepEqual(canonicalTopics([B, A]), canonicalTopics([A, B]))
})
run('hash: same set -> same hash in any order; different set -> different hash; 14 hex', () => {
  assert.equal(multiHash([A, B]), multiHash([B, A]))
  assert.notEqual(multiHash([A, B]), multiHash([A, C]))
  assert.notEqual(multiHash([A, B]), multiHash([A, B, C]))
  assert.match(multiHash([A, B]), /^[0-9a-f]{14}$/)
})
run('kind / activity id round trip', () => {
  const h = multiHash([A, B])
  assert.equal(multiKind(h, 1), `multi:${h}`); assert.equal(multiKind(h, 3), `multi:${h}:3`)
  assert.equal(multiNumber(multiKind(h, 1), h), 1); assert.equal(multiNumber(multiKind(h, 3), h), 3)
  assert.equal(multiNumber(multiKind(multiHash([A, C]), 2), h), 0)
  assert.equal(multiNumber('practice', h), 0); assert.equal(multiNumber('practice:2', h), 0)
  assert.equal(multiActivityId(h, 1), `lesson-multi-${h}`); assert.equal(multiActivityId(h, 2), `lesson-multi-${h}-p2`)
  assert.deepEqual(parseMultiActivityId(multiActivityId(h, 1)), { hash: h, exercise: 1 })
  assert.deepEqual(parseMultiActivityId(multiActivityId(h, 5)), { hash: h, exercise: 5 })
  assert.equal(parseMultiActivityId('lesson-cpp-raii-lifetime'), null)
  assert.equal(parseMultiActivityId(`${multiActivityId(h, 1)}:transfer`), null)
})
run('multi kinds never collide with single-topic kinds nor match the regenerate filters (practice / practice:%)', () => {
  const h = multiHash([A, B])
  for (const n of [1, 2, 9]) { const kind = multiKind(h, n); assert.ok(kind !== 'practice' && !kind.startsWith('practice:') && !kind.startsWith('lecture')) }
  assert.equal(parseActivityId(multiActivityId(h, 1)), null) // not mistaken for a single-topic id
})
run('attempt view: title, chips and exercise number from stored topics', () => {
  const h = multiHash([A, B])
  const row = { id: 'x', activity_id: multiActivityId(h, 2), completion_state: 'completed', score: '1', hint_count: 1, created_at: new Date().toISOString(), feedback: { max_score: 1, title: 'Ignore me', topics: [A, B] }, execution_result: { topics: [A, B] } }
  const v = attemptView(row)
  assert.equal(v.title, multiTitle(['RAII & object lifetime', 'Smart pointers & ownership']).replace(/RAII & object lifetime/, v.topics[0].label).replace(/Smart pointers & ownership/, v.topics[1].label))
  assert.ok(v.title.startsWith('Multi-topic: ') && v.title.includes(' + '))
  assert.equal(v.multi, true); assert.equal(v.topics.length, 2); assert.equal(v.exercise, 2); assert.equal(v.status, 'Passed'); assert.ok(v.meta.startsWith('Exercise 2'))
  assert.equal(attemptTopics(row).length, 2)
  const bare = attemptView({ ...row, feedback: { max_score: 1 }, execution_result: {} })
  assert.equal(bare.title, 'Multi-topic exercise'); assert.equal(bare.topics.length, 0); assert.equal(bare.multi, true)
  assert.equal(attemptView({ id: 'y', activity_id: 'lesson-c-bit-operations', completion_state: 'completed', score: '0', created_at: '', feedback: {}, execution_result: {} }).multi, false)
})
run('recent exercises: multi attempts carry their topics; ones without stored topics are skipped', () => {
  const h = multiHash([A, B])
  const rows = [
    { id: '1', activity_id: multiActivityId(h, 1), created_at: '2026-10-22T10:00:00Z', score: '1', completion_state: 'completed', feedback: { max_score: 1, topics: [A, B] }, execution_result: {} },
    { id: '2', activity_id: multiActivityId(h, 1), created_at: '2026-10-22T09:00:00Z', score: '1', completion_state: 'completed', feedback: { max_score: 1 }, execution_result: {} },
    { id: '3', activity_id: 'lesson-c-bit-operations', created_at: '2026-10-22T08:00:00Z', score: '0', completion_state: 'completed', feedback: {}, execution_result: {} },
  ]
  const recent = recentExercises(rows)
  assert.equal(recent.length, 2); assert.equal(recent[0].kind, 'Multi-topic exercise'); assert.equal(recent[0].topics?.length, 2); assert.equal(recent[1].topicId, 'bit-operations')
})
run('stored topics are sanitised', () => {
  assert.deepEqual(topicsFromStored([A, A, { domain_id: 'x', topic_id: 'y' }, 3, null]), [A])
  assert.deepEqual(topicsFromStored('nope'), [])
})
run('per-topic queue progression and sanitising', () => {
  const q = makeQueue([C, D, E])
  assert.equal(queueAfter(q, 'c/pointers-bounds')?.label, 'Next topic exercise (2 of 3)')
  assert.deepEqual(queueAfter(q, 'c/pointers-bounds')?.ref, D)
  assert.equal(queueAfter(q, 'c/bit-operations')?.label, 'Next topic exercise (3 of 3)')
  assert.equal(queueAfter(q, 'bsp/gpio-pinmux'), null) // last one
  assert.equal(queueAfter(q, 'cpp/raii-lifetime'), null) // not in the queue
  assert.equal(queueAfter(null, 'c/pointers-bounds'), null)
  assert.equal(sanitizeQueue({ topics: [C], index: 0 }), null) // needs 2+
  assert.equal(sanitizeQueue({ topics: [C, D, E, A, B], index: 0 }), null)
  assert.deepEqual(sanitizeQueue({ topics: [C, D], index: 9 }), { topics: [C, D], index: 1 })
  assert.equal(sanitizeQueue('x'), null)
})
console.log('all practice-multi checks passed')
