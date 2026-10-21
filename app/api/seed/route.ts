import { authMiddleware, getCurrentUserId, getDb } from 'lyzr-architect-pg'
import { eq, sql } from 'lyzr-architect-pg/schema'
import { NextRequest } from 'next/server'
import {
  activities,
  assessment_items,
  assessment_sessions,
  learner_profiles,
  recommendations,
  topic_mastery,
} from '@/lib/db/schema'
import { singleFlight } from '@/lib/single-flight'
import { DOMAINS, topicLabel } from '@/lib/taxonomy'

// Each domain starts on the first topic of its learning path.
const firstTopic = (domainId: string) => DOMAINS.find((domain) => domain.id === domainId)!.topics[0].id

// The seeded diagnostic prompt is about validating a packet header inside a buffer.
const SEED_ACTIVITY_TOPIC = 'pointers-bounds'

const domains = [
  { domain_id: 'c', topic_id: firstTopic('c'), score: '0', level_band: 'Basic', confidence: '0', focus: 'Start with a mixed diagnostic to establish type and control-flow evidence.' },
  { domain_id: 'cpp', topic_id: firstTopic('cpp'), score: '0', level_band: 'Basic', confidence: '0', focus: 'Use the diagnostic to map core-language fundamentals.' },
  { domain_id: 'linux', topic_id: firstTopic('linux'), score: '0', level_band: 'Basic', confidence: '0', focus: 'Use the diagnostic to map shell and file-handling fundamentals.' },
  { domain_id: 'networking', topic_id: firstTopic('networking'), score: '0', level_band: 'Basic', confidence: '0', focus: 'Use the diagnostic to map the TCP/IP layering model.' },
  { domain_id: 'bsp', topic_id: firstTopic('bsp'), score: '0', level_band: 'Basic', confidence: '0', focus: 'Use the diagnostic to map cross-compilation and toolchain fundamentals.' },
]

// Concurrent calls for one user share one run (singleFlight); the advisory lock inside the transaction also
// serializes calls that slip past it, so each check-then-insert below sees the rows a competing call just wrote.
export const POST = authMiddleware(async (_req: NextRequest) => {
  try {
    const ownerId = getCurrentUserId()
    if (!ownerId) return Response.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    await singleFlight(`seed:${ownerId}`, () => getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`seed:${ownerId}`}))`)
      const isEmpty = async (table: typeof learner_profiles | typeof topic_mastery | typeof recommendations | typeof assessment_sessions) =>
        (await tx.select({ id: table.id }).from(table).where(eq(table.owner_user_id, ownerId)).limit(1)).length === 0

      if (await isEmpty(learner_profiles)) {
        await tx.insert(learner_profiles).values({
          owner_user_id: ownerId,
          display_name: 'New learner',
          preferences: { study_minutes: 25, theme: 'system', domains: domains.map((domain) => domain.domain_id) },
          onboarding_state: { status: 'needs_diagnostic', goals: [], experience: null },
        })
      }

      if (await isEmpty(topic_mastery)) {
        await tx.insert(topic_mastery).values(domains.map((domain) => ({
          owner_user_id: ownerId,
          domain_id: domain.domain_id,
          topic_id: domain.topic_id,
          pack_version: 'v1.0.0',
          score: domain.score,
          level_band: domain.level_band,
          confidence: domain.confidence,
          evidence_summary: { state: 'awaiting_diagnostic', evidence: [], recommended_focus: domain.focus },
        })))
      }

      let [activity] = await tx.select().from(activities).where(eq(activities.owner_user_id, ownerId)).limit(1)
      if (!activity) {
        ;[activity] = await tx.insert(activities).values({
          owner_user_id: ownerId,
          domain_id: 'c',
          topic_id: SEED_ACTIVITY_TOPIC,
          pack_version: 'v1.0.0',
          level: 'Basic',
          format: 'diagnostic',
          prompt: 'Begin with a mixed diagnostic. Explain how you would prove a packet header and its declared payload fit inside the received buffer.',
          starter_assets: [{ path: 'diagnostic.md', content: 'A short mixed diagnostic will adapt after each response.' }],
          rubric: [{ criterion: 'Explains bounds before dereference', weight: 1, evidence: 'Written reasoning and safe validation order' }],
          status: 'diagnostic_ready',
        }).returning()
      }

      if (activity?.id && await isEmpty(recommendations)) {
        await tx.insert(recommendations).values({
          owner_user_id: ownerId,
          activity_id: activity.id,
          activity_metadata: { domain: 'C', topic: topicLabel('c', SEED_ACTIVITY_TOPIC), level_band: 'Basic', format: 'Mixed diagnostic', estimated_duration_minutes: 12 },
          rationale: 'A mixed diagnostic gives the coach evidence across all five domain packs before recommending practice.',
          status: 'queued',
        })
      }

      if (await isEmpty(assessment_sessions)) {
        const [session] = await tx.insert(assessment_sessions).values({
          owner_user_id: ownerId,
          mode: 'knowledge_check',
          topic_coverage: domains.map(({ domain_id, topic_id }) => ({ domain_id, topic_id, weight: 1 })),
          timing_policy: { timed: false, question_count: 5, reveal_correctness_during_test: false },
          score: '0',
          confidence: '0',
          mastery_impact: { max_level_band_delta: 0, max_score_delta: 0, state: 'pending_diagnostic' },
          status: 'ready',
        }).returning()
        if (session?.id) {
          await tx.insert(assessment_items).values({
            owner_user_id: ownerId,
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
    }))

    return Response.json({ success: true, seeded: true })
  } catch (error) {
    console.error('[API] /api/seed:', error)
    const message = 'Unable to seed learner data'
    return Response.json({ success: false, error: message }, { status: 400 })
  }
})
