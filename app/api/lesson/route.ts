import { authMiddleware, getDb } from 'lyzr-architect-pg'
import { and, eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'
import { ClaudeCliError, MODEL, runClaudeJson } from '@/lib/claude-cli'
import { LECTURE_SCHEMA, PRACTICE_SCHEMA } from '@/lib/coach-schema'
import { topic_lessons } from '@/lib/db/schema'
import { DOMAIN_TOPIC_OPTIONS } from '@/lib/learning-topics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/lesson { domain_id, topic_id, part: 'lecture' | 'practice' }
// Both parts are cached per topic in topic_lessons (shared by all learners), so Claude only
// writes a given lesson once. The response has the same shape as the coach result the UI renders.

const LECTURE_PROMPT = `You are the Embedded Systems Learning Coach for EmbedPath. Write a lesson-first explanation of ONE topic for an engineer new to it.
Order: (1) theory explanation, (2) a guided worked example with concrete code, commands or a trace, (3) common pitfalls, then a retrieval check and a transfer exercise prompt (prompts only, do not give answers away).
Keep it tight: 3 to 4 sections, each roughly 120-200 words, examples short. Use selected_depth "standard". Never mix in other topics except clearly labeled prerequisites. Do not claim production hardware safety without human review. Respond only through the required JSON schema.`

const PRACTICE_PROMPT = `You are the Embedded Systems Learning Coach for EmbedPath. Design ONE focused practice exercise for the given topic, to be attempted after the lesson.
Include a prompt, constraints, small starter files, a test plan and a rubric. Provide exactly 4 staged hints with labels "conceptual nudge", "focused clue", "pseudocode or command outline", "explained solution", all with revealed=false and stages 1-4. The exercise must stay on the stated topic. Respond only through the required JSON schema.`

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
    const domain = DOMAIN_TOPIC_OPTIONS.find((entry) => entry.id === body.domain_id)
    const topic = domain?.topics.find((entry) => entry.id === body.topic_id)
    const part = body.part === 'practice' ? 'practice' : body.part === 'lecture' ? 'lecture' : null
    if (!domain || !topic || !part) return NextResponse.json({ success: false, error: 'domain_id, topic_id and part (lecture | practice) are required' }, { status: 400 })

    const db = getDb()
    const where = and(eq(topic_lessons.domain_id, domain.id), eq(topic_lessons.topic_id, topic.id), eq(topic_lessons.kind, part))
    const [cached] = await db.select().from(topic_lessons).where(where).limit(1)

    let content = cached?.content as Record<string, unknown> | undefined
    if (!content) {
      const request_ = `Domain: ${domain.label} (${domain.id})\nTopic: ${topic.label} (${topic.id})\nselected_topic_only: true`
      content = await runClaudeJson({
        systemPrompt: part === 'lecture' ? LECTURE_PROMPT : PRACTICE_PROMPT,
        message: request_,
        jsonSchema: part === 'lecture' ? LECTURE_SCHEMA : PRACTICE_SCHEMA,
      }) as Record<string, unknown>
      await db.insert(topic_lessons).values({ domain_id: domain.id, topic_id: topic.id, kind: part, content, model: MODEL }).onConflictDoNothing()
    }

    const result = assemble(domain.id, topic.id, domain.label, topic.label, content as Parameters<typeof assemble>[4])
    return NextResponse.json({
      success: true,
      cached: Boolean(cached),
      response: { status: 'success', result, metadata: { agent_name: 'Embedded Systems Learning Coach via Claude CLI', timestamp: new Date().toISOString(), request_id: null } },
    })
  } catch (error) {
    if (error instanceof ClaudeCliError) return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    console.error('[API] POST /api/lesson error:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to prepare this lesson' }, { status: 500 })
  }
})
