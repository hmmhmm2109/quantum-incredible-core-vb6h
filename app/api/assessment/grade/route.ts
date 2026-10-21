import { authMiddleware, getCurrentUserId, getDb, scopedRepo } from 'lyzr-architect-pg'
import { and, eq, sql } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'
import { assessment_items, assessment_responses, learning_events, topic_mastery } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Grades one multiple-choice item on the server against the answer key stored when
// Claude wrote the question, so submitting is instant and does not spend a Claude call.
// The response has the same shape as the coach result that app/page.tsx already renders.
// The result is also persisted here, in one transaction: the response row, the topic mastery
// update (bounded by mastery_impact_cap) and a learning event. Grading is idempotent per item,
// so a re-submit returns the stored result and never applies mastery twice.

type AnswerKey = { correct_options?: string[]; explanation?: string; misconception?: string }

const CONFIDENCE: Record<string, number> = { low: 0.3, medium: 0.6, high: 0.9 }
const DOMAIN_LABEL: Record<string, string> = { c: 'C', cpp: 'C++', linux: 'Linux', networking: 'Networking', bsp: 'BSP' }
const BANDS = ['Basic', 'Intermediate', 'Advanced']
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export const POST = authMiddleware(async (request: NextRequest) => {
  try {
    const body = await request.json()
    const itemId = typeof body.item_id === 'string' ? body.item_id : ''
    const selected: string[] = Array.isArray(body.selected_answers) ? body.selected_answers.filter((value: unknown): value is string => typeof value === 'string') : []
    if (!itemId) return NextResponse.json({ success: false, error: 'item_id is required' }, { status: 400 })
    if (selected.length === 0) return NextResponse.json({ success: false, error: 'Select at least one answer' }, { status: 400 })

    const item = await scopedRepo(assessment_items).findOne(eq(assessment_items.id, itemId))
    const key = (item?.review_snapshot as { answer_key?: AnswerKey } | undefined)?.answer_key
    if (!item || !key?.correct_options?.length) return NextResponse.json({ success: false, error: 'Assessment item not found' }, { status: 404 })

    const question = item.generated_question as { stem?: string; options?: string[]; type?: string; domain_id?: string; topic?: string; topic_id?: string }
    const options = question.options ?? []
    const chosen = [...new Set(selected.filter((value) => options.includes(value)))]
    if (chosen.length === 0) return NextResponse.json({ success: false, error: 'Selected answers do not match this question' }, { status: 400 })

    const correct = key.correct_options
    const hits = chosen.filter((value) => correct.includes(value)).length
    const wrong = chosen.length - hits
    const earned = Math.max(0, (hits - wrong) / correct.length)
    const fullyCorrect = hits === correct.length && wrong === 0

    const difficulty = (item.difficulty_factors as { score?: number; factors?: string[] } | undefined) ?? {}
    const domainId = question.domain_id ?? 'c'
    const topicId = question.topic_id ?? slug(question.topic ?? 'general')
    const confidence = CONFIDENCE[String(body.confidence ?? '').toLowerCase()] ?? 0.5
    const levelBand = (difficulty.score ?? 3) >= 4 ? 'Advanced' : (difficulty.score ?? 3) >= 3 ? 'Intermediate' : 'Basic'
    const justification = typeof body.justification === 'string' ? body.justification.trim() : ''

    const result = {
      request_type: 'assessment_submission',
      activity: {
        id: item.id, domain_id: domainId, topic_id: topicId, domain: DOMAIN_LABEL[domainId] ?? domainId, topic: question.topic ?? null,
        pack_version: item.blueprint_version, level_band: levelBand, format: 'assessment', prerequisites: [], estimated_duration_minutes: 5,
        learning_objectives: [], prompt: question.stem ?? null, constraints: [], starter_files: [],
        execution_profile: { runtime: 'none', language: null, allowed_actions: [], time_limit_seconds: 0, network: 'unavailable' },
        test_plan: [], rubric: [],
      },
      feedback: {
        summary: fullyCorrect ? 'Correct. Your selection matches the answer key.' : hits > 0 ? 'Partly correct. You found some, but not all, of the right choices.' : 'Not correct this time.',
        findings: fullyCorrect ? [] : [{ category: 'conceptual', severity: 'warning', message: key.misconception ?? 'A distractor matched a common misconception.', evidence: `You selected: ${chosen.join(' | ')}` }],
        public_test_feedback: [],
        hidden_test_summary: null,
        correctness: { score: Number(earned.toFixed(2)), max_score: 1, confidence },
        reasoning_evaluation: { score: 0, max_score: 0, summary: justification ? 'Your written reasoning is recorded as confidence evidence; it does not change the answer-key score.' : 'No written reasoning was supplied.' },
        safety_findings: [],
      },
      hints: [],
      lecture: {
        selected_depth: 'none', estimated_duration_minutes: 0, selection_reason: '', learning_objectives: [], sections: [],
        common_failure_mode: fullyCorrect ? null : key.misconception ?? null, recap: [],
        retrieval_check: { prompt: null, answer_rule: null }, transfer_exercise: { prompt: null, format: null },
      },
      assessment: {
        mode: 'knowledge_check', blueprint_id: item.blueprint_id, blueprint_version: item.blueprint_version,
        topic_coverage: [{ domain_id: domainId, topic_id: topicId, weight: 1 }],
        calibrated_difficulty: { score: difficulty.score ?? 3, factors: difficulty.factors ?? [] },
        validation_state: 'model generated, graded on the server',
        answer_rules: (item.answer_rules as { type?: string; partial_credit?: string } | undefined) as { type: string; partial_credit: string },
        score: { earned: Number(earned.toFixed(2)), possible: 1, confidence },
        mastery_impact_cap: { max_level_band_delta: 1, max_score_delta: 8 },
        review: [{ item_id: item.id, topic_id: topicId, valid: true, explanation: key.explanation ?? '', misconception: fullyCorrect ? null : key.misconception ?? null }],
      },
      // One item is thin evidence, so confidence is capped low no matter what the learner reports.
      mastery_evidence: [{
        domain_id: domainId, topic_id: topicId, level_band: levelBand, score: Math.round(earned * 100), confidence: Math.min(confidence, 0.4),
        evidence: [`${fullyCorrect ? 'Answered' : 'Missed'} a ${levelBand.toLowerCase()} question on ${question.topic ?? topicId}.`],
        recommended_focus: fullyCorrect ? 'Try a harder question on this topic.' : key.misconception ?? 'Review this topic and retry a similar question.',
      }],
      recommended_next_activity: {
        domain_id: domainId, topic_id: topicId, format: 'practice', level_band: levelBand,
        reason: fullyCorrect ? 'You answered correctly, so a harder scenario on the same topic is the next step.' : 'Retry this topic with a fresh scenario to confirm the misconception is gone.',
        estimated_duration_minutes: 20,
      },
      learner_explanation: key.explanation ?? '',
      claude_cli: { available: true, status: 'completed', notice: 'Claude CLI wrote this question; grading ran instantly on the server against its stored answer key.', job_id: null, exit_code: 0, stdout: '', stderr: '', changed_files: [] },
    }

    const ownerId = getCurrentUserId()
    if (!ownerId) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    const evidence = result.mastery_evidence[0]
    const cap = result.assessment.mastery_impact_cap

    const stored = await getDb().transaction(async (tx) => {
      // Serialize concurrent submits of the same item so only one of them applies mastery.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`grade:${ownerId}:${item.id}`}))`)
      const [existing] = await tx.select().from(assessment_responses).where(and(eq(assessment_responses.owner_user_id, ownerId), eq(assessment_responses.item_id, item.id))).limit(1)
      if (existing) return { result: existing.feedback, replayed: true as const, selected_answers: existing.selected_answers }

      const [current] = await tx.select().from(topic_mastery).where(and(eq(topic_mastery.owner_user_id, ownerId), eq(topic_mastery.domain_id, domainId), eq(topic_mastery.topic_id, topicId))).limit(1)
      const before = Number(current?.score ?? 0)
      const beforeConfidence = Number(current?.confidence ?? 0)
      // Move toward the evidence score in proportion to its confidence, never more than the cap.
      const scoreDelta = Math.max(-cap.max_score_delta, Math.min(cap.max_score_delta, Math.round((evidence.score - before) * evidence.confidence)))
      const after = Math.max(0, Math.min(100, before + scoreDelta))
      const confidenceDelta = Math.min(1 - beforeConfidence, Number((evidence.confidence * 0.25).toFixed(2)))
      const bandFromScore = BANDS[after >= 70 ? 2 : after >= 40 ? 1 : 0]
      const beforeBand = Math.max(0, BANDS.indexOf(current?.level_band ?? 'Basic'))
      const newBand = BANDS[Math.max(beforeBand - cap.max_level_band_delta, Math.min(beforeBand + cap.max_level_band_delta, BANDS.indexOf(bandFromScore)))]
      const previous = (current?.evidence_summary as { evidence?: unknown } | undefined)?.evidence
      const summary = { state: 'assessed', evidence: [...(Array.isArray(previous) ? previous : []), ...evidence.evidence].slice(-5), recommended_focus: evidence.recommended_focus }

      await tx.insert(assessment_responses).values({
        item_id: item.id, session_id: item.session_id, selected_answers: chosen, justification, response_time_ms: 0,
        partial_credit: String(result.assessment.score.earned), feedback: result, challenge_state: 'completed', mastery_evidence: result.mastery_evidence, owner_user_id: ownerId,
      })
      if (current) await tx.update(topic_mastery).set({ score: String(after), level_band: newBand, confidence: String(Math.max(0, Math.min(1, Number((beforeConfidence + confidenceDelta).toFixed(2))))), evidence_summary: summary }).where(eq(topic_mastery.id, current.id))
      else await tx.insert(topic_mastery).values({ domain_id: domainId, topic_id: topicId, pack_version: item.blueprint_version, score: String(after), level_band: newBand, confidence: String(confidenceDelta), evidence_summary: summary, owner_user_id: ownerId })
      await tx.insert(learning_events).values({
        event_type: 'assessment', domain_id: domainId, topic_id: topicId, evidence: { item_id: item.id, earned: result.assessment.score.earned, mastery_evidence: result.mastery_evidence },
        score_delta: String(after - before), confidence_delta: String(confidenceDelta), owner_user_id: ownerId,
      })
      return { result, replayed: false as const, selected_answers: chosen }
    })

    return NextResponse.json({
      success: true,
      response: { status: 'success', result: stored.result, metadata: { agent_name: 'Assessment grader', timestamp: new Date().toISOString(), request_id: null } },
      ...(stored.replayed && { replayed: true, selected_answers: stored.selected_answers }),
    })
  } catch (error) {
    console.error('[API] POST /api/assessment/grade error:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to grade this answer' }, { status: 500 })
  }
})
