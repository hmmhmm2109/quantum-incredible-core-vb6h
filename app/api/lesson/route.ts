import { authMiddleware, getDb } from 'lyzr-architect-pg'
import { and, eq, like, or } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'
import { ClaudeCliError, MODEL, runClaudeJson } from '@/lib/claude-cli'
import { LECTURE_SCHEMA, PRACTICE_SCHEMA } from '@/lib/coach-schema'
import { topic_lessons } from '@/lib/db/schema'
import { findDomain, findTopic } from '@/lib/taxonomy'
import { singleFlight } from '@/lib/single-flight'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/lesson { domain_id, topic_id, part: 'lecture' | 'practice', action?, regenerate? }
// Every part is cached per topic in topic_lessons (shared by all learners), so Claude only
// writes a given lesson once. The response has the same shape as the coach result the UI renders.
// `action` (lecture only) returns a variant of the lecture, cached under kind `lecture:<action>`.
// `regenerate: true` (lecture only) deletes every cached row of the topic (lecture, variants, practice) and writes a new lecture.

const LECTURE_PROMPT = `You are the Embedded Systems Learning Coach for EmbedPath. Write a lesson-first explanation of ONE topic for an engineer new to it.
Order: (1) theory explanation, (2) a guided worked example with concrete code, commands or a trace, (3) common pitfalls, then a retrieval check and a transfer exercise prompt (prompts only, do not give answers away).
Write 4 sections, each roughly 150-250 words, examples short. Every listed subtopic must be covered by at least one section or bullet, and the lesson should build on the previous topic without repeating it. Use selected_depth "standard". Never mix in other topics except clearly labeled prerequisites. Do not claim production hardware safety without human review. Respond only through the required JSON schema.`

const PRACTICE_PROMPT = `You are the Embedded Systems Learning Coach for EmbedPath. Design ONE focused practice exercise for the given topic, to be attempted after the lesson.
Include a prompt, constraints, small starter files, a test plan and a rubric. Provide exactly 4 staged hints with labels "conceptual nudge", "focused clue", "pseudocode or command outline", "explained solution", all with revealed=false and stages 1-4. The exercise must stay on the stated topic. Respond only through the required JSON schema.`

// Variants of the lecture; the key is the `action` sent by the UI and the cache kind is `lecture:<key>`.
const LECTURE_ACTIONS: Record<string, string> = {
  'explain-more': 'Rewrite the lesson with more depth: spell out intermediate steps and reasoning, add one more pitfall, and keep every subtopic covered.',
  shorter: 'Rewrite the lesson as a compact version: 2 sections of roughly 80-120 words each, essentials and one short example only.',
  'another-example': 'Keep the theory brief and replace the worked example with a different scenario (different code or trace) than the base lesson.',
  prerequisites: 'Write a refresher of the listed prerequisites instead of the topic itself: one section per prerequisite with what must be known before this topic, and how it connects to it.',
}

const EMPTY_ACTIVITY = {
  id: null, domain_id: null, topic_id: null, domain: null, topic: null, pack_version: 'v1', level_band: 'Basic', format: 'lesson',
  prerequisites: [], estimated_duration_minutes: 15, learning_objectives: [], prompt: null, constraints: [], starter_files: [],
  execution_profile: { runtime: 'none', language: null, allowed_actions: [], time_limit_seconds: 0, network: 'unavailable' },
  test_plan: [], rubric: [],
}
const EMPTY_LECTURE = {
  selected_depth: 'none', estimated_duration_minutes: 0, selection_reason: '', learning_objectives: [], sections: [],
  common_failure_mode: null, recap: [], retrieval_check: { prompt: null, answer_rule: null }, transfer_exercise: { prompt: null, format: null },
}

function assemble(domainId: string, topicId: string, domainLabel: string, topicName: string, parts: { lecture?: unknown; learner_explanation?: string; activity?: unknown; hints?: unknown[] }) {
  const stub = { ...EMPTY_ACTIVITY, id: `lesson-${domainId}-${topicId}`, domain_id: domainId, topic_id: topicId, domain: domainLabel, topic: topicName }
  return {
    request_type: parts.lecture ? 'lecture_request' : 'practice_request',
    activity: parts.activity ? { ...stub, ...(parts.activity as object), id: stub.id, domain_id: domainId, topic_id: topicId, domain: domainLabel, topic: topicName } : stub,
    feedback: {
      summary: '', findings: [], public_test_feedback: [], hidden_test_summary: null,
      correctness: { score: 0, max_score: 0, confidence: 0 }, reasoning_evaluation: { score: 0, max_score: 0, summary: '' }, safety_findings: [],
    },
    hints: parts.hints ?? [],
    lecture: parts.lecture ? { ...EMPTY_LECTURE, ...(parts.lecture as object) } : EMPTY_LECTURE,
    assessment: {
      mode: 'none', blueprint_id: null, blueprint_version: null, topic_coverage: [], calibrated_difficulty: { score: 0, factors: [] }, validation_state: 'none',
      answer_rules: { type: 'none', partial_credit: '' }, score: { earned: 0, possible: 0, confidence: 0 }, mastery_impact_cap: { max_level_band_delta: 0, max_score_delta: 0 }, review: [],
    },
    mastery_evidence: [],
    recommended_next_activity: { domain_id: domainId, topic_id: topicId, format: 'practice', level_band: 'Basic', reason: 'Practice what the lesson just covered.', estimated_duration_minutes: 15 },
    learner_explanation: parts.learner_explanation ?? '',
    claude_cli: { available: true, status: 'completed', notice: 'Lesson written by Claude CLI and cached per topic.', job_id: null, exit_code: 0, stdout: '', stderr: '', changed_files: [] },
  }
}

export const POST = authMiddleware(async (request: NextRequest) => {
  try {
    const body = await request.json().catch(() => ({}))
    const domain = findDomain(String(body.domain_id ?? ''))
    const topic = domain ? findTopic(domain.id, String(body.topic_id ?? '')) : undefined
    const part = body.part === 'practice' ? 'practice' : body.part === 'lecture' ? 'lecture' : null
    if (!domain || !topic || !part) return NextResponse.json({ success: false, error: 'domain_id, topic_id and part (lecture | practice) are required' }, { status: 400 })
    const action = body.action === undefined || body.action === null ? null : String(body.action)
    if (action !== null && (part !== 'lecture' || !Object.hasOwn(LECTURE_ACTIONS, action))) return NextResponse.json({ success: false, error: `action must be one of: ${Object.keys(LECTURE_ACTIONS).join(', ')} (lecture only)` }, { status: 400 })
    const regenerate = body.regenerate === true
    if (regenerate && (part !== 'lecture' || action !== null)) return NextResponse.json({ success: false, error: 'regenerate applies to the base lecture only' }, { status: 400 })

    const db = getDb()
    const kind = action ? `lecture:${action}` : part
    const whereKind = (k: string) => and(eq(topic_lessons.domain_id, domain.id), eq(topic_lessons.topic_id, topic.id), eq(topic_lessons.kind, k))

    // Cache lookup + single-flight generation for one kind. `replace` overwrites the row (used by regenerate).
    const getOrCreate = async (k: string, build: () => Promise<Record<string, unknown>>, replace = false) => {
      const where = whereKind(k)
      const [cached] = await db.select().from(topic_lessons).where(where).limit(1)
      if (cached && !replace) return { content: cached.content as Record<string, unknown>, cached: true }
      // Concurrent misses for the same lesson share one Claude call; regenerate has its own key so it never joins a stale in-flight call.
      const content = await singleFlight(`lesson:${domain.id}:${topic.id}:${k}${replace ? ':regen' : ''}`, async () => {
        const generated = await build()
        if (replace) await db.insert(topic_lessons).values({ domain_id: domain.id, topic_id: topic.id, kind: k, content: generated, model: MODEL }).onConflictDoUpdate({ target: [topic_lessons.domain_id, topic_lessons.topic_id, topic_lessons.kind], set: { content: generated, model: MODEL, updated_at: new Date() } })
        else await db.insert(topic_lessons).values({ domain_id: domain.id, topic_id: topic.id, kind: k, content: generated, model: MODEL }).onConflictDoNothing()
        // Return the persisted row (another process may have won the insert) so every caller sees the same content.
        const [stored] = await db.select().from(topic_lessons).where(where).limit(1)
        return (stored?.content as Record<string, unknown> | undefined) ?? generated
      })
      return { content, cached: false }
    }

    const prerequisites = (topic.prerequisites ?? []).map((id) => findTopic(domain.id, id)?.label ?? id)
    const previous = domain.topics.find((entry) => entry.order === topic.order - 1)
    const topicRequest = [
      `Domain: ${domain.label} (${domain.id})`, `Topic: ${topic.label} (${topic.id})`,
      `Subtopics to cover (each at least once):\n${topic.subtopics.map((entry) => `- ${entry}`).join('\n')}`,
      `Prerequisites: ${prerequisites.length > 0 ? prerequisites.join(', ') : 'none'}`,
      `Previous topic in the course: ${previous?.label ?? 'none (this is the first topic)'}`,
      'selected_topic_only: true',
    ].join('\n')
    const generateLecture = async () => await runClaudeJson({ systemPrompt: LECTURE_PROMPT, message: topicRequest, jsonSchema: LECTURE_SCHEMA }) as Record<string, unknown>

    let result: { content: Record<string, unknown>; cached: boolean }
    if (regenerate) {
      // Drop the lecture, its variants and the practice exercise; the lecture is rewritten now, the practice is rebuilt by the next practice request.
      await db.delete(topic_lessons).where(and(eq(topic_lessons.domain_id, domain.id), eq(topic_lessons.topic_id, topic.id), or(eq(topic_lessons.kind, 'lecture'), like(topic_lessons.kind, 'lecture:%'), eq(topic_lessons.kind, 'practice'))))
      result = await getOrCreate('lecture', generateLecture, true)
    } else if (action) {
      result = await getOrCreate(kind, async () => {
        const base = await getOrCreate('lecture', generateLecture)
        return await runClaudeJson({ systemPrompt: `${LECTURE_PROMPT}\nYou are producing a VARIANT of an existing lesson. ${LECTURE_ACTIONS[action]}`, message: `${topicRequest}\n\nExisting lesson (JSON):\n${JSON.stringify(base.content)}`, jsonSchema: LECTURE_SCHEMA }) as Record<string, unknown>
      })
    } else {
      result = await getOrCreate(part, part === 'lecture' ? generateLecture : async () => await runClaudeJson({ systemPrompt: PRACTICE_PROMPT, message: topicRequest, jsonSchema: PRACTICE_SCHEMA }) as Record<string, unknown>)
    }

    const assembled = assemble(domain.id, topic.id, domain.label, topic.label, result.content as Parameters<typeof assemble>[4])
    return NextResponse.json({
      success: true,
      cached: result.cached,
      response: { status: 'success', result: assembled, metadata: { agent_name: 'Embedded Systems Learning Coach via Claude CLI', timestamp: new Date().toISOString(), request_id: null } },
    })
  } catch (error) {
    if (error instanceof ClaudeCliError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[API] POST /api/lesson error:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to prepare this lesson' }, { status: 500 })
  }
})
