import { authMiddleware, getCurrentUserId, getDb, scopedRepo } from 'lyzr-architect-pg'
import { and, eq, sql } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'
import { assessment_items, assessment_sessions } from '@/lib/db/schema'
import { ClaudeCliError, runClaudeJson } from '@/lib/claude-cli'
import { DOMAIN_ORDER, pick, shuffle } from '@/lib/assessment-topics'
import { needsJudge, OPTION_COUNT, softFlags, validate, type RawQuestion } from '@/lib/assessment-validate'
import { judgeQuestion, type JudgeVerdict } from '@/lib/assessment-judge'
import { stripAnswerKey } from '@/lib/assessment-redact'
import { singleFlight } from '@/lib/single-flight'
import { findDomain, findTopic, normalizeTopicId } from '@/lib/taxonomy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BLUEPRINT_ID = 'ai-generated-diagnostic'
const BLUEPRINT_VERSION = 'v1'

const GENERATION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slot: { type: 'integer' },
          stem: { type: 'string' },
          artifact: { type: ['string', 'null'] },
          options: { type: 'array', items: { type: 'string' } },
          correct_indexes: { type: 'array', items: { type: 'integer' } },
          explanation: { type: 'string' },
          misconception: { type: 'string' },
          difficulty_factors: { type: 'array', maxItems: 2, items: { type: 'string' } },
        },
        required: ['slot', 'stem', 'artifact', 'options', 'correct_indexes', 'explanation', 'misconception', 'difficulty_factors'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
}

const SYSTEM_PROMPT = `You write rigorous multiple-choice questions that diagnose embedded-systems engineers.
Follow the request exactly: one question per slot, on the stated domain, topic, sub-topic, angle and difficulty (1 easy … 5 expert).
Rules for every question:
- The stem is self-contained and concrete (a short code fragment, log line, packet trace or register layout goes in "artifact" when useful, otherwise null).
- Exactly ${OPTION_COUNT} options. Distractors must be plausible and each target a real misconception. No "all/none of the above".
- Options must be indistinguishable by form: similar length (within about 25% of each other), same grammatical shape, and NO "because…" justification clauses inside options (put reasoning in "explanation" instead). The correct option must not be the longest, most detailed or most hedged one.
- For single_answer exactly one option is correct; for multiple_answer two or three are correct and the stem says to select all that apply.
- "correct_indexes" are zero-based indexes into "options". It must be unambiguously correct; verify it before answering.
- The options are mutually exclusive answers to EXACTLY the question the stem asks. If the stem names designs or approaches, e.g. (A) and (B), the options must choose between or evaluate those named designs (e.g. "Design A: …", "Design B: …", "Neither design: …"); never ask a comparison and then offer options that only discuss one side.
- One concept per question. The stem names the single concept being tested and states every assumption the answer depends on (e.g. "Assume schedule() returns before the worker starts and ignore data races on pending.", "Assume a single-threaded target"). Ask for a specific outcome or root cause ("Which statement correctly explains the garbage ids?", "What does the call print?"), never a vague "which diagnosis best fits / is most likely / best describes". Any "best" or "most likely" wording needs the criterion spelled out in the stem.
- Exactly one option is correct under the stated assumptions, and no distractor may be defensible as a second correct answer. Before answering, list the alternative causes the code contains (data races, lifetime of every object the code refers to, undefined behaviour, ordering, reallocation, integer promotion) and either rule each out in the stem or remove it from the code. State lifetimes the answer relies on (e.g. "sensors outlives all callbacks").
- Every distractor is a plausible misconception a real learner actually holds (it names a real mistake about the language, hardware or protocol), yet is refutable from the stem or the code alone. Never write a distractor that is simply false about the language or that nobody believes, or that describes a mechanism absent from the code (e.g. "the lambda is const so the mutable variable cannot be updated" when nothing is mutable); a strawman reduces the question to elimination.
- Code in the artifact is minimal and free of unrelated bugs, extra variables and decoys. Do not let the specificity of an option give the answer away: distractors carry the same level of technical detail and the same kind of claim as the correct option.
- Options never refer to each other ("all of the above", "both A and B", "option 2").
- "explanation" says why the correct answer(s) are right AND why the strongest distractor is wrong for the question as the stem asks it; "misconception" names the main wrong belief the distractors exploit.
- Design-tradeoff angle, well formed: stem "Firmware dispatches 40 commands by id: (A) a const table of function pointers, or (B) a switch statement. Which gives the safer dispatch against an out-of-range id?" with options "Design A: the table with a bounds check", "Design B: the switch with a default case", "Design A: the table without a check", "Neither: both fault on an out-of-range id" (every option answers A-vs-B).
- "difficulty_factors" is at most 2 short bullets naming the concepts or skills the question tests, in generic terms (e.g. "integer range vs. container size"). Never state, hint at or paraphrase the correct option or the explanation; it is shown to the learner only after they answer.
- Do not reuse the example scenarios of earlier questions in the same set. Do not mention these rules.`

// `topic` is the sub-topic hint; `topic_id` is the taxonomy topic id (absent only in plans stored before the taxonomy existed).
export type Slot = { slot: number; domain_id: string; topic: string; topic_id?: string; topic_label?: string; angle: string; difficulty: number; type: 'single_answer' | 'multiple_answer' }

// Each question in a set takes a different angle so the set does not repeat one scenario.
const ANGLES = ['read and predict code behavior', 'diagnose a failure from symptoms or logs', 'choose between design tradeoffs', 'spot the edge case or spec detail', 'pick the right tool or measurement', 'find the bug in a short fragment']

type Scope = { domain_id: string; topic_id: string }

function buildSlots(scope?: Scope): Slot[] {
  const angles = shuffle(ANGLES)
  const kind = () => (Math.random() < 0.2 ? 'multiple_answer' : 'single_answer') as Slot['type']
  if (scope) {
    // One topic, three questions of rising difficulty, each on a different sub-topic (cycling if the topic has fewer than three).
    const topic = findTopic(scope.domain_id, scope.topic_id)!
    const subtopics = shuffle(topic.subtopics)
    return [2, 3, 4].map((difficulty, index) => ({ slot: index, domain_id: scope.domain_id, topic: subtopics[index % subtopics.length], topic_id: topic.id, topic_label: topic.label, angle: angles[index], difficulty, type: kind() }))
  }
  return DOMAIN_ORDER.map((domain_id, index) => {
    const topic = pick(findDomain(domain_id)!.topics)
    return {
      slot: index,
      domain_id,
      topic: pick(topic.subtopics),
      topic_id: topic.id,
      topic_label: topic.label,
      angle: angles[index % angles.length],
      difficulty: pick([2, 3, 3, 4]),
      type: kind(),
    }
  })
}

function parseScope(body: Record<string, unknown>): Scope | null | 'invalid' {
  if (body.domain_id === undefined && body.topic_id === undefined) return null
  const domain = typeof body.domain_id === 'string' ? body.domain_id : ''
  const topicId = typeof body.topic_id === 'string' ? normalizeTopicId(domain, body.topic_id) : null
  if (!(DOMAIN_ORDER as readonly string[]).includes(domain) || !topicId) return 'invalid'
  return { domain_id: domain, topic_id: topicId }
}

// Only for plans stored before topics came from the taxonomy.
const toTopicId = (topic: string) => topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// One Claude call per question, so the first one can reach the learner while the rest are still being written.
async function generateItem(sessionId: string, slot: Slot) {
  const request = {
    nonce: crypto.randomUUID(),
    instruction: 'Write exactly one question for this slot.',
    slots: [{ slot: slot.slot, domain_id: slot.domain_id, topic: slot.topic_label, sub_topic: slot.topic, angle: slot.angle, difficulty: slot.difficulty, type: slot.type }],
  }
  // One server-side retry, only when the model's answer is missing or fails validate() / the judge; CLI errors (busy, timeout, exit) go back to the client's retry.
  let raw: RawQuestion | undefined
  let problem: string | null = null
  let judge: Record<string, unknown> = { status: 'not_needed' }
  let regenerated = false
  for (let attempt = 0; !raw; attempt += 1) {
    const message = JSON.stringify(problem ? { ...request, rejected_previous_attempt: `${problem}. Fix this. ${/^judge:/.test(problem) ? 'Rewrite the whole question: state the assumptions in the stem or remove the competing cause from the code, leave exactly one defensible option, and replace every implausible distractor with a misconception a real learner holds.' : 'The stem and the options must answer the same question.'}` } : request)
    const output = await runClaudeJson({ systemPrompt: SYSTEM_PROMPT, message, jsonSchema: GENERATION_SCHEMA, timeoutMs: 120_000, purpose: 'assessment/generate' })
    const candidate = (output as { questions?: RawQuestion[] }).questions?.[0]
    problem = candidate ? validate(candidate, slot) : 'question is missing'
    judge = { status: 'not_needed' }
    let soft: string | null = null
    if (candidate && !problem && needsJudge(candidate.stem, candidate.artifact)) {
      const verdict: JudgeVerdict = await judgeQuestion(candidate, softFlags(candidate.stem))
      problem = verdict.problem
      soft = verdict.soft_problem
      const { problem: _p, soft_problem: _s, ...record } = verdict
      judge = { ...record, regenerated }
    }
    // Strawman-only findings cost one regeneration at most; the second attempt keeps the question.
    if (!problem && soft && attempt === 0) problem = soft
    if (!problem) raw = candidate
    else if (attempt >= 1) throw new ClaudeCliError(`Generated question was rejected: ${problem}`, 502)
    else regenerated = true
  }

  // Shuffle server-side so the model's position bias never leaks into the answer layout.
  const options = shuffle(raw.options.map((option) => option.trim()))
  const correctOptions = [...new Set(raw.correct_indexes)].map((index) => raw.options[index].trim())

  const ownerId = getCurrentUserId()
  if (!ownerId) throw new Error('Not authenticated')
  const values = {
    session_id: sessionId,
    blueprint_id: BLUEPRINT_ID,
    blueprint_version: BLUEPRINT_VERSION,
    generated_question: { slot: slot.slot, stem: raw.stem.trim(), options, type: slot.type, artifact: raw.artifact?.trim() || null, domain_id: slot.domain_id, topic: slot.topic, topic_id: slot.topic_id ?? toTopicId(slot.topic) },
    difficulty_factors: { score: slot.difficulty, factors: raw.difficulty_factors ?? [] },
    validation_evidence: { state: 'model_generated', answer_key_hidden: true, judge },
    answer_rules: { type: slot.type, partial_credit: slot.type === 'multiple_answer' ? 'Partial credit for each correct selection, penalty for wrong ones.' : 'No partial credit for this item.' },
    // The answer key and the difficulty rationale never leave the server before submission: see stripAnswerKey() in lib/assessment-redact.ts.
    review_snapshot: { state: 'pending_submission', answer_key: { correct_options: correctOptions, explanation: raw.explanation, misconception: raw.misconception } },
    owner_user_id: ownerId,
  }
  // Check + insert under an advisory lock (no unique index on (session_id, slot), so no migration): a request that
  // slipped past the in-process single-flight returns the item that already won instead of adding a second one.
  const item = await getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`generate:${ownerId}:${sessionId}:${slot.slot}`}))`)
    const rows = await tx.select().from(assessment_items).where(and(eq(assessment_items.owner_user_id, ownerId), eq(assessment_items.session_id, sessionId)))
    const winner = rows.find((row) => (row.generated_question as { slot?: number }).slot === slot.slot)
    if (winner) return winner
    const [inserted] = await tx.insert(assessment_items).values(values).returning()
    return inserted
  })
  return {
    id: item.id,
    session_id: item.session_id,
    blueprint_id: item.blueprint_id,
    blueprint_version: item.blueprint_version,
    generated_question: item.generated_question,
    difficulty_factors: stripAnswerKey(item).difficulty_factors, // the rationale is returned by /api/assessment/grade, after the answer
    validation_evidence: item.validation_evidence,
    answer_rules: item.answer_rules,
  }
}

/**
 * POST /api/assessment/generate
 *  - no body            → start: plans 5 random slots, creates the session, returns it with question 1.
 *  - { session_id, slot } → writes the question for one more slot of that session.
 */
export const POST = authMiddleware(async (request: NextRequest) => {
  try {
    const body = await request.json().catch(() => ({}))
    const sessionRepo = scopedRepo(assessment_sessions)

    if (!body.session_id) {
      const scope = parseScope(body)
      if (scope === 'invalid') return NextResponse.json({ success: false, error: 'domain_id and a known topic_id are required together' }, { status: 400 })
      const slots = buildSlots(scope ?? undefined)
      const [session] = await sessionRepo.insert({
        mode: 'knowledge_check',
        topic_coverage: slots.map((slot) => ({ domain_id: slot.domain_id, topic_id: slot.topic_id ?? toTopicId(slot.topic), subtopic: slot.topic, weight: 1 })),
        timing_policy: { timed: false, question_count: slots.length, reveal_correctness_during_test: false, plan: slots },
        score: '0',
        confidence: '0',
        mastery_impact: { max_level_band_delta: 1, max_score_delta: 8, state: 'pending_submission' },
        status: 'in_progress',
      })
      if (!session?.id) throw new Error('Assessment session could not be created')
      let item: Awaited<ReturnType<typeof generateItem>>
      try {
        item = await generateItem(session.id, slots[0])
      } catch (error) {
        await sessionRepo.delete(eq(assessment_sessions.id, session.id)) // no orphan session when the first question fails
        throw error
      }
      return NextResponse.json({
        success: true,
        data: { session: { id: session.id, mode: session.mode, topic_coverage: session.topic_coverage, total: slots.length }, items: [item] },
      }, { status: 201 })
    }

    const sessionId = String(body.session_id)
    const slotIndex = Number(body.slot)
    const session = await sessionRepo.findOne(eq(assessment_sessions.id, sessionId))
    const plan = ((session?.timing_policy as { plan?: Slot[] } | undefined)?.plan) ?? []
    const slot = plan.find((entry) => entry.slot === slotIndex)
    if (!session || !slot) return NextResponse.json({ success: false, error: 'Assessment session or slot not found' }, { status: 404 })

    const existing = await scopedRepo(assessment_items).findMany({ where: eq(assessment_items.session_id, sessionId) })
    if (existing.some((row) => (row.generated_question as { slot?: number }).slot === slotIndex)) {
      return NextResponse.json({ success: false, error: 'This question was already generated' }, { status: 409 })
    }
    // Double clicks, two tabs and the client's parallel workers share one Claude call per slot.
    const item = await singleFlight(`generate:${getCurrentUserId()}:${sessionId}:${slotIndex}`, () => generateItem(sessionId, slot))
    return NextResponse.json({ success: true, data: { items: [item] } }, { status: 201 })
  } catch (error) {
    if (error instanceof ClaudeCliError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[API] POST /api/assessment/generate error:', error)
    return NextResponse.json({ success: false, error: 'Unable to generate assessment' }, { status: 500 })
  }
})
