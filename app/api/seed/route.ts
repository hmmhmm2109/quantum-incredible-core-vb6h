import { authMiddleware, scopedRepo } from 'lyzr-architect-pg'
import {
  activities,
  assessment_items,
  assessment_sessions,
  learner_profiles,
  recommendations,
  topic_mastery,
} from '@/lib/db/schema'

const domains = [
  { domain_id: 'c', topic_id: 'pointers-and-bounds', score: '0', level_band: 'Basic', confidence: '0', focus: 'Start with a mixed diagnostic to establish pointer and bounds evidence.' },
  { domain_id: 'cpp', topic_id: 'raii-and-lifetime', score: '0', level_band: 'Basic', confidence: '0', focus: 'Use the diagnostic to map ownership and object-lifetime fundamentals.' },
  { domain_id: 'linux', topic_id: 'processes-and-signals', score: '0', level_band: 'Basic', confidence: '0', focus: 'Trace a safe process scenario and explain signal behavior.' },
  { domain_id: 'networking', topic_id: 'packet-diagnosis', score: '0', level_band: 'Basic', confidence: '0', focus: 'Interpret a packet trace before choosing a troubleshooting path.' },
  { domain_id: 'bsp', topic_id: 'device-tree', score: '0', level_band: 'Basic', confidence: '0', focus: 'Read a device-tree fragment and connect it to board bring-up.' },
]

export const POST = authMiddleware(async () => {
  try {
    const profileRepo = scopedRepo(learner_profiles)
    if ((await profileRepo.count()) === 0) {
      await profileRepo.insert({
        display_name: 'New learner',
        preferences: { study_minutes: 25, theme: 'system', domains: domains.map((domain) => domain.domain_id) },
        onboarding_state: { status: 'needs_diagnostic', goals: [], experience: null },
      })
    }

    const masteryRepo = scopedRepo(topic_mastery)
    if ((await masteryRepo.count()) === 0) {
      await masteryRepo.insert(domains.map((domain) => ({
        domain_id: domain.domain_id,
        topic_id: domain.topic_id,
        pack_version: 'v1.0.0',
        score: domain.score,
        level_band: domain.level_band,
        confidence: domain.confidence,
        evidence_summary: { state: 'awaiting_diagnostic', evidence: [], recommended_focus: domain.focus },
      })))
    }

    const activityRepo = scopedRepo(activities)
    let [activity] = await activityRepo.findMany({ limit: 1 })
    if (!activity) {
      ;[activity] = await activityRepo.insert({
        domain_id: 'c',
        topic_id: 'pointers-and-bounds',
        pack_version: 'v1.0.0',
        level: 'Basic',
        format: 'diagnostic',
        prompt: 'Begin with a mixed diagnostic. Explain how you would prove a packet header and its declared payload fit inside the received buffer.',
        starter_assets: [{ path: 'diagnostic.md', content: 'A short mixed diagnostic will adapt after each response.' }],
        rubric: [{ criterion: 'Explains bounds before dereference', weight: 1, evidence: 'Written reasoning and safe validation order' }],
        status: 'diagnostic_ready',
      })
    }

    const recommendationRepo = scopedRepo(recommendations)
    if ((await recommendationRepo.count()) === 0 && activity?.id) {
      await recommendationRepo.insert({
        activity_id: activity.id,
        activity_metadata: { domain: 'C', topic: 'Pointers & bounds', level_band: 'Basic', format: 'Mixed diagnostic', estimated_duration_minutes: 12 },
        rationale: 'A mixed diagnostic gives the coach evidence across all five domain packs before recommending practice.',
        status: 'queued',
      })
    }

    const assessmentRepo = scopedRepo(assessment_sessions)
    if ((await assessmentRepo.count()) === 0) {
      const [session] = await assessmentRepo.insert({
        mode: 'knowledge_check',
        topic_coverage: domains.map(({ domain_id, topic_id }) => ({ domain_id, topic_id, weight: 1 })),
        timing_policy: { timed: false, question_count: 5, reveal_correctness_during_test: false },
        score: '0',
        confidence: '0',
        mastery_impact: { max_level_band_delta: 0, max_score_delta: 0, state: 'pending_diagnostic' },
        status: 'ready',
      })
      if (session?.id) {
        await scopedRepo(assessment_items).insert({
          session_id: session.id,
          blueprint_id: 'mixed-diagnostic-v1',
          blueprint_version: 'v1.0.0',
          generated_question: { stem: 'Which evidence should come first when inspecting an untrusted packet buffer?', options: ['Prove the fixed header fits', 'Allocate a larger buffer', 'Skip validation for zero payloads'], type: 'single_answer' },
          difficulty_factors: { reasoning_steps: 1, prerequisite_depth: 1, ambiguity: 'low' },
          validation_evidence: { state: 'validated', answer_key_hidden: true },
          answer_rules: { type: 'single_answer', partial_credit: 'No partial credit for this item' },
          review_snapshot: { state: 'pending_submission' },
        })
      }
    }

    return Response.json({ success: true, seeded: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to seed learner data'
    return Response.json({ success: false, error: message }, { status: 400 })
  }
})
