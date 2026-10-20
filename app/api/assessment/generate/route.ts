import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import { eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'
import { assessment_items, assessment_sessions } from '@/lib/db/schema'
import { ClaudeCliError, runClaudeJson } from '@/lib/claude-cli'
import { DOMAIN_ORDER, DOMAIN_TOPICS, pick, shuffle } from '@/lib/assessment-topics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BLUEPRINT_ID = 'ai-generated-diagnostic'
const BLUEPRINT_VERSION = 'v1'
const OPTION_COUNT = 4

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
          difficulty_factors: { type: 'array', items: { type: 'string' } },
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
Follow the request exactly: one question per slot, on the stated domain, sub-topic, angle and difficulty (1 easy … 5 expert).
Rules for every question:
- The stem is self-contained and concrete (a short code fragment, log line, packet trace or register layout goes in "artifact" when useful, otherwise null).
- Exactly ${OPTION_COUNT} options. Distractors must be plausible and each target a real misconception. No "all/none of the above".
- Options must be indistinguishable by form: similar length (within about 25% of each other), same grammatical shape, and NO "because…" justification clauses inside options (put reasoning in "explanation" instead). The correct option must not be the longest, most detailed or most hedged one.
- For single_answer exactly one option is correct; for multiple_answer two or three are correct and the stem says to select all that apply.
- "correct_indexes" are zero-based indexes into "options". It must be unambiguously correct; verify it before answering.
- "explanation" says why the correct answer(s) are right; "misconception" names the main wrong belief the distractors exploit.
- Do not reuse the example scenarios of earlier questions in the same set. Do not mention these rules.`

export type Slot = { slot: number; domain_id: string; topic: string; topic_id?: string; angle: string; difficulty: number; type: 'single_answer' | 'multiple_answer' }

// Each question in a set takes a different angle so the set does not repeat one scenario.
const ANGLES = ['read and predict code behavior', 'diagnose a failure from symptoms or logs', 'choose between design tradeoffs', 'spot the edge case or spec detail', 'pick the right tool or measurement', 'find the bug in a short fragment']

type Scope = { domain_id: string; topic_id: string; topic_label: string }

function buildSlots(scope?: Scope): Slot[] {
  const angles = shuffle(ANGLES)
  const kind = () => (Math.random() < 0.2 ? 'multiple_answer' : 'single_answer') as Slot['type']
  if (scope) {
    // One topic, three questions of rising difficulty.
    return [2, 3, 4].map((difficulty, index) => ({ slot: index, domain_id: scope.domain_id, topic: scope.topic_label, topic_id: scope.topic_id, angle: angles[index], difficulty, type: kind() }))
  }
  return DOMAIN_ORDER.map((domain_id, index) => ({
    slot: index,
    domain_id,
    topic: pick(DOMAIN_TOPICS[domain_id]),
    angle: angles[index % angles.length],
    difficulty: pick([2, 3, 3, 4]),
    type: kind(),
  }))
}

function parseScope(body: Record<string, unknown>): Scope | null | 'invalid' {
  if (body.domain_id === undefined && body.topic_id === undefined) return null
  const domain = typeof body.domain_id === 'string' ? body.domain_id : ''
  const label = typeof body.topic_label === 'string' ? body.topic_label.trim().slice(0, 80) : ''
  const topicId = typeof body.topic_id === 'string' ? toTopicId(body.topic_id).slice(0, 80) : ''
  if (!(DOMAIN_ORDER as readonly string[]).includes(domain) || !label || !topicId) return 'invalid'
  return { domain_id: domain, topic_id: topicId, topic_label: label }
}

type RawQuestion = {
  slot: number
  stem: string
  artifact: string | null
  options: string[]
  correct_indexes: number[]
  explanation: string
  misconception: string
  difficulty_factors: string[]
}

function validate(raw: RawQuestion, slot: Slot): string | null {
  if (!raw.stem?.trim()) return 'empty stem'
  if (!Array.isArray(raw.options) || raw.options.length !== OPTION_COUNT) return 'wrong option count'
  const trimmed = raw.options.map((option) => option.trim())
  if (trimmed.some((option) => !option) || new Set(trimmed.map((option) => option.toLowerCase())).size !== OPTION_COUNT) return 'blank or duplicate option'
  const correct = [...new Set(raw.correct_indexes)]
  if (correct.some((index) => !Number.isInteger(index) || index < 0 || index >= OPTION_COUNT)) return 'correct index out of range'
  if (slot.type === 'single_answer' && correct.length !== 1) return 'single answer needs exactly one correct option'
  if (slot.type === 'multiple_answer' && (correct.length < 2 || correct.length > 3)) return 'multiple answer needs 2-3 correct options'
  return null
}

const toTopicId = (topic: string) => topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// One Claude call per question, so the first one can reach the learner while the rest are still being written.
async function generateItem(sessionId: string, slot: Slot) {
  const request = {
    nonce: crypto.randomUUID(),
    instruction: 'Write exactly one question for this slot.',
    slots: [{ slot: slot.slot, domain_id: slot.domain_id, sub_topic: slot.topic, angle: slot.angle, difficulty: slot.difficulty, type: slot.type }],
  }
  const output = await runClaudeJson({ systemPrompt: SYSTEM_PROMPT, message: JSON.stringify(request), jsonSchema: GENERATION_SCHEMA, timeoutMs: 120_000 })
  const raw = (output as { questions?: RawQuestion[] }).questions?.[0]
  if (!raw) throw new ClaudeCliError(`Question for slot ${slot.slot} is missing`, 502)
  const problem = validate(raw, slot)
  if (problem) throw new ClaudeCliError(`Generated question was rejected: ${problem}`, 502)

  // Shuffle server-side so the model's position bias never leaks into the answer layout.
  const options = shuffle(raw.options.map((option) => option.trim()))
  const correctOptions = [...new Set(raw.correct_indexes)].map((index) => raw.options[index].trim())

  const [item] = await scopedRepo(assessment_items).insert({
    session_id: sessionId,
    blueprint_id: BLUEPRINT_ID,
    blueprint_version: BLUEPRINT_VERSION,
    generated_question: { slot: slot.slot, stem: raw.stem.trim(), options, type: slot.type, artifact: raw.artifact?.trim() || null, domain_id: slot.domain_id, topic: slot.topic, topic_id: slot.topic_id ?? toTopicId(slot.topic) },
    difficulty_factors: { score: slot.difficulty, factors: raw.difficulty_factors ?? [] },
    validation_evidence: { state: 'model_generated', answer_key_hidden: true },
    answer_rules: { type: slot.type, partial_credit: slot.type === 'multiple_answer' ? 'Partial credit for each correct selection, penalty for wrong ones.' : 'No partial credit for this item.' },
    // The answer key never leaves the server before submission: see stripAnswerKey() in /api/assessment_items.
    review_snapshot: { state: 'pending_submission', answer_key: { correct_options: correctOptions, explanation: raw.explanation, misconception: raw.misconception } },
  })
  return {
    id: item.id,
    session_id: item.session_id,
    blueprint_id: item.blueprint_id,
    blueprint_version: item.blueprint_version,
    generated_question: item.generated_question,
    difficulty_factors: item.difficulty_factors,
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
      if (scope === 'invalid') return NextResponse.json({ success: false, error: 'domain_id, topic_id and topic_label are required together' }, { status: 400 })
      const slots = buildSlots(scope ?? undefined)
      const [session] = await sessionRepo.insert({
        mode: 'knowledge_check',
        topic_coverage: slots.map((slot) => ({ domain_id: slot.domain_id, topic_id: slot.topic_id ?? toTopicId(slot.topic), weight: 1 })),
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
    const item = await generateItem(sessionId, slot)
    return NextResponse.json({ success: true, data: { items: [item] } }, { status: 201 })
  } catch (error) {
    if (error instanceof ClaudeCliError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[API] POST /api/assessment/generate error:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to generate assessment' }, { status: 500 })
  }
})
