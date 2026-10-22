// Run: npx tsx scripts/check-attempt-view.ts
import assert from 'node:assert/strict'
import { attemptView, parseActivityId, relativeTime, shortActivityTitle } from '../lib/attempt-view'

const now = new Date('2026-10-22T10:00:00Z').getTime()
const ago = (ms: number) => new Date(now - ms).toISOString()
const run = (name: string, fn: () => void) => { fn(); console.log('ok  ', name) }

run('parse ids incl. -pN and :transfer', () => {
  assert.equal(parseActivityId('lesson-c-bit-operations-p3')?.exercise, 3)
  assert.equal(parseActivityId('lesson-cpp-stl-algorithms-p2')?.topicId, 'stl-algorithms')
  assert.equal(parseActivityId('lesson-c-bit-operations:transfer')?.transfer, true)
  assert.equal(parseActivityId('b0f12c75b361c115defc635e'), null)
})
run('title: short summary only, never the placeholder or a paragraph', () => {
  assert.equal(shortActivityTitle('Complete the Makefile.'), 'Complete the Makefile')
  assert.equal(shortActivityTitle('Activity response'), null)
  assert.equal(shortActivityTitle('You are bringing up a tiny userspace payload for an AArch64 Linux target. The project...'), null)
})
run('relative time', () => {
  assert.equal(relativeTime(ago(5_000), now).short, 'just now')
  assert.equal(relativeTime(ago(13 * 60_000), now).short, '13 min ago')
  assert.equal(relativeTime(ago(3 * 3600_000), now).short, '3 h ago')
  assert.equal(relativeTime(ago(2 * 86400_000), now).short, '2 d ago')
  assert.equal(relativeTime('', now).short, 'Unknown date')
})
run('new row: full score -> Passed 1/1, exercise 2 title', () => {
  const v = attemptView({ id: 'a', activity_id: 'lesson-cpp-stl-algorithms-p2', completion_state: 'completed', score: '1', hint_count: 0, created_at: ago(2 * 3600_000), feedback: { max_score: 1, domain: 'Fix the sort comparator.' }, execution_result: {} }, 0, now)
  assert.equal(v.status, 'Passed'); assert.equal(v.scoreLabel, '1/1'); assert.equal(v.title, 'Fix the sort comparator'); assert.equal(v.meta, 'Exercise 2'); assert.equal(v.when, '2 h ago')
})
run('new row: 2/5 -> Partial; 0/5 -> Needs work', () => {
  assert.equal(attemptView({ activity_id: 'lesson-c-bit-operations', score: 2, completion_state: 'completed', feedback: { max_score: 5 } }, 0, now).status, 'Partial')
  assert.equal(attemptView({ activity_id: 'lesson-c-bit-operations', score: 0, completion_state: 'completed', feedback: { max_score: 5 } }, 0, now).status, 'Needs work')
})
run('legacy row without max_score: never claims Passed', () => {
  const v = attemptView({ id: 'o', activity_id: 'lesson-bsp-cross-compilation-toolchain', completion_state: 'completed', score: '9', hint_count: 1, created_at: ago(86400_000), feedback: { domain: 'You are bringing up a tiny userspace payload for an AArch64 Linux target. The project has a library.' } }, 0, now)
  assert.equal(v.status, 'Submitted'); assert.equal(v.tone, 'neutral'); assert.equal(v.title, 'Cross-compilation & toolchain · Exercise 1'); assert.equal(v.meta, 'Exercise 1 · 1 hint')
  assert.equal(attemptView({ activity_id: 'lesson-c-types-control-flow', score: '0', completion_state: 'completed', feedback: {} }, 0, now).status, 'Needs work')
})
run('transfer row uses verdict; draft; unknown id', () => {
  const t = attemptView({ activity_id: 'lesson-c-bit-operations:transfer', completion_state: 'partial', score: 72, feedback: { title: 'Transfer exercise: Bit operations', verdict: 'partial' } }, 0, now)
  assert.equal(t.status, 'Partial'); assert.equal(t.scoreLabel, '72/100'); assert.equal(t.title, 'Transfer exercise: Bit operations')
  assert.equal(attemptView({ activity_id: 'lesson-c-bit-operations', completion_state: 'draft', score: 0, feedback: { state: 'draft' } }, 0, now).status, 'Draft')
  const u = attemptView({ id: 'x', activity_id: 'b0f12c', completion_state: 'completed', score: 1, feedback: { domain: 'Activity response' } }, 0, now)
  assert.equal(u.title, 'Practice attempt'); assert.equal(u.status, 'Submitted')
})
