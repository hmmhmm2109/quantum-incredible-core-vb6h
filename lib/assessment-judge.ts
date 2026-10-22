import { runClaudeJson } from '@/lib/claude-cli'
import type { RawQuestion } from '@/lib/assessment-validate'

// Only `coherent` and `ambiguous` are required so a provider that drops an optional field (Copilot output is validated, not enforced) still passes.
export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    competing_causes: { type: 'array', items: { type: 'string' } },
    coherent: { type: 'boolean' },
    problem: { type: 'string' },
    ambiguous: { type: 'boolean' },
    alt_correct_option: { type: ['string', 'null'] },
    unstated_assumption: { type: ['string', 'null'] },
    strawman_options: { type: 'array', items: { type: 'string' } },
  },
  required: ['coherent', 'ambiguous'],
  additionalProperties: false,
}

export const JUDGE_PROMPT = `You audit one multiple-choice question before a learner sees it. Do two checks.
1. Coherence: coherent=false (and one sentence in "problem") if any option is not a direct answer to the exact question the stem asks, if the stem compares named designs but the options do not all weigh those designs, or if the keyed option does not answer the question as asked.
2. Ambiguity: act as a skeptical expert who is trying to defend a different answer. Read the code and the stem, list every plausible cause or reading (data races, lifetime of every referenced object, undefined behaviour, ordering, unstated platform or threading assumptions, what the stem leaves unspecified). Write them in "competing_causes" (one short line each, including the keyed one; [] only for pure recall). Then decide:
   - A competing cause that is really present in the code and that the stem does not rule out (for example a data race when the stem mentions another thread, or the lifetime of a referenced object that the stem never states) IS an unstated assumption, even when the keyed answer is the likelier one: set ambiguous=true and name it in "unstated_assumption". 'Which diagnosis best fits' over code with two real hazards is ambiguous unless the stem excludes one.
   - ambiguous=true if ANOTHER option (not the keyed one) is also defensible under the stem as written ("alt_correct_option": quote it and say why in a few words), or if an unstated assumption is needed for the keyed option to be right ("unstated_assumption": state it), or if the keyed option is not the best answer for a reason the stem does not rule out. Vague wording such as "best fits" or "most likely" does not by itself make a question ambiguous, but it makes this check stricter.
   - ambiguous=false only if exactly one option survives your attack using nothing but the stem, the code and standard language or hardware semantics.
   - "strawman_options": quote every distractor that no real learner would believe, because it states something false about the language or hardware that is obviously wrong, or is nonsensical (e.g. claims a mechanism that does not exist in the code). A good distractor is a plausible misconception that can be refuted from the stem or code. Use [] if none.
Do not judge difficulty or style. Set alt_correct_option and unstated_assumption to null when ambiguous=false.`

export type JudgeVerdict = {
  status: 'passed' | 'skipped'
  coherent: boolean
  ambiguous: boolean
  alt_correct_option: string | null
  unstated_assumption: string | null
  strawman_options: string[]
  problem: string | null // set when the question should be regenerated
  soft_problem: string | null // only strawman distractors: regenerate once if possible, accept on the second attempt
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)

// A failed judge call (busy, timeout, bad output) deliberately fails open, because regenerating a question that already
// passed the heuristics costs more than it protects; the skip is logged and recorded in validation_evidence.judge.
export async function judgeQuestion(question: RawQuestion, hints: string[] = [], provider?: 'claude' | 'copilot'): Promise<JudgeVerdict> {
  try {
    const keyed = [...new Set(question.correct_indexes)].map((index) => question.options[index])
    const message = JSON.stringify({ stem: question.stem, artifact: question.artifact, options: question.options, keyed_options: keyed, explanation: question.explanation, ...(hints.length ? { heuristic_flags: hints } : {}) })
    const verdict = (await runClaudeJson({ systemPrompt: JUDGE_PROMPT, message, jsonSchema: JUDGE_SCHEMA, timeoutMs: 90_000, purpose: 'assessment/judge', ...(provider ? { provider } : {}) })) as Record<string, unknown>
    const coherent = verdict.coherent !== false
    const ambiguous = verdict.ambiguous === true
    const alt = text(verdict.alt_correct_option)
    const assumption = text(verdict.unstated_assumption)
    const strawmen = Array.isArray(verdict.strawman_options) ? verdict.strawman_options.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()) : []
    let problem: string | null = null
    if (!coherent) problem = `judge: ${text(verdict.problem) ?? 'options do not answer the stem'}`
    else if (ambiguous) problem = `judge: ambiguous question${alt ? `; also defensible: "${alt}"` : ''}${assumption ? `; unstated assumption: ${assumption}` : ''}${!alt && !assumption && text(verdict.problem) ? `; ${text(verdict.problem)}` : ''}`
    const soft = !problem && strawmen.length >= 2 ? `judge: implausible distractors nobody believes (${strawmen.map((entry) => `"${entry}"`).join(', ')})` : null
    return { status: 'passed', coherent, ambiguous, alt_correct_option: alt, unstated_assumption: assumption, strawman_options: strawmen, problem, soft_problem: soft }
  } catch (error) {
    console.warn('[assessment/generate] judge-skipped: judge call failed, accepting the question unjudged:', error instanceof Error ? error.message : error)
    return { status: 'skipped', coherent: true, ambiguous: false, alt_correct_option: null, unstated_assumption: null, strawman_options: [], problem: null, soft_problem: null }
  }
}
