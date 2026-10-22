// Run: npx tsx scripts/check-domain-score.ts
import assert from 'node:assert/strict'
import { aggregateDomain, aggregateOverall } from '../lib/domain-score'

const t = (score: unknown, assessed = true) => ({ score, assessed })
const unassessed = (n: number) => Array.from({ length: n }, () => t(0, false))
const run = (name: string, fn: () => void) => { fn(); console.log('ok  ', name) }

run('(a) 1 topic at 80, 10 unassessed -> 7 Basic, provisional', () => {
  const r = aggregateDomain([t(80), ...unassessed(10)])
  assert.equal(r.score, 7); assert.equal(r.level, 'Basic'); assert.equal(r.assessedCount, 1); assert.equal(r.totalCount, 11)
  assert.equal(r.assessedAverage, 80); assert.equal(r.provisional, true); assert.equal(r.weakestIndex, 0)
})
run('(b) all topics 70 -> Advanced, not provisional', () => {
  const r = aggregateDomain(Array.from({ length: 11 }, () => t(70)))
  assert.equal(r.score, 70); assert.equal(r.level, 'Advanced'); assert.equal(r.provisional, false); assert.equal(r.coverage, 1)
})
run('(c) one topic 0 and four at 80 -> 64 Intermediate', () => {
  const r = aggregateDomain([t(0), t(80), t(80), t(80), t(80)])
  assert.equal(r.score, 64); assert.equal(r.level, 'Intermediate'); assert.equal(r.weakestIndex, 0); assert.equal(r.assessedAverage, 64)
})
run('(d) numeric strings', () => {
  const r = aggregateDomain([t('80.00'), t('60'), t('abc'), t('')])
  assert.equal(r.score, 35); assert.equal(r.level, 'Basic'); assert.equal(r.assessedCount, 4)
})
run('(e) awaiting_diagnostic / learned rows are unassessed (assessed:false, even with a score)', () => {
  const r = aggregateDomain([t(90, false), t(0, false), t(50)])
  assert.equal(r.score, 17); assert.equal(r.assessedCount, 1); assert.equal(r.assessedAverage, 50)
  const none = aggregateDomain([t(0, false), t(0, false)])
  assert.equal(none.level, 'Not started'); assert.equal(none.assessedAverage, null); assert.equal(none.weakestIndex, -1); assert.equal(none.provisional, false)
})
run('(f) empty data', () => {
  const r = aggregateDomain([])
  assert.deepEqual([r.score, r.level, r.totalCount, r.coverage, r.weakestIndex], [0, 'Not started', 0, 0, -1])
  assert.equal(aggregateOverall([]).level, 'Not started')
})
run('overall is topic-count weighted', () => {
  const r = aggregateOverall([[t(100), t(100)], [t(0)]])
  assert.equal(r.score, 67)
})
run('clamps out-of-range', () => { assert.equal(aggregateDomain([t(500)]).score, 100); assert.equal(aggregateDomain([t(-5)]).score, 0) })
console.log('all domain-score checks passed')
