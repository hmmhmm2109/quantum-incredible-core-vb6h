import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import { eq } from 'lyzr-architect-pg/schema'
import { NextRequest, NextResponse } from 'next/server'
import { assessment_items } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Grades one multiple-choice item on the server against the answer key stored when
// Claude wrote the question, so submitting is instant and does not spend a Claude call.
// The response has the same shape as the coach result that app/page.tsx already renders.

type AnswerKey = { correct_options?: string[]; explanation?: string; misconception?: string }

const CONFIDENCE: Record<string, number> = { low: 0.3, medium: 0.6, high: 0.9 }
const DOMAIN_LABEL: Record<string, string> = { c: 'C', cpp: 'C++', linux: 'Linux', networking: 'Networking', bsp: 'BSP' }
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

    const question = item.generated_question as { stem?: string; options?: string[]; type?: string; domain_id?: string; topic?: string }
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
    const topicId = slug(question.topic ?? 'general')
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

    return NextResponse.json({
      success: true,
      response: { status: 'success', result, metadata: { agent_name: 'Assessment grader', timestamp: new Date().toISOString(), request_id: null } },
    })
  } catch (error) {
    console.error('[API] POST /api/assessment/grade error:', error)
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to grade this answer' }, { status: 500 })
  }
})
