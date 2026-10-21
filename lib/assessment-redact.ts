// What an unanswered assessment item may show the browser: review_snapshot.answer_key (correct options, keyed
// explanation, misconception) and difficulty_factors.factors (the difficulty rationale, which tends to paraphrase the key)
// stay on the server until /api/assessment/grade returns them for the answered item.
export function stripAnswerKey<T>(row: T): T {
  if (!row || typeof row !== 'object') return row
  const record = row as { review_snapshot?: unknown; difficulty_factors?: unknown }
  const next: Record<string, unknown> = { ...record }
  const snapshot = record.review_snapshot
  if (snapshot && typeof snapshot === 'object') {
    const { answer_key: _hidden, ...rest } = snapshot as Record<string, unknown>
    next.review_snapshot = rest
  }
  const difficulty = record.difficulty_factors
  if (difficulty && typeof difficulty === 'object' && !Array.isArray(difficulty)) {
    const { factors: _rationale, ...rest } = difficulty as Record<string, unknown>
    next.difficulty_factors = rest
  }
  return next as T
}
