export { users } from 'lyzr-architect-pg/schema'

import {
  generateId,
  index,
  integer,
  jsonb,
  numeric,
  ownerUserId,
  pgTable,
  text,
  timestamps,
  uniqueIndex,
} from 'lyzr-architect-pg/schema'

export const learner_profiles = pgTable(
  'learner_profiles',
  {
    id: text('id').primaryKey().$defaultFn(() => generateId()),
    display_name: text('display_name').notNull(),
    preferences: jsonb('preferences').notNull(),
    onboarding_state: jsonb('onboarding_state').notNull(),
    owner_user_id: ownerUserId(),
    ...timestamps,
  },
  (table) => [index('learner_profiles_owner_idx').on(table.owner_user_id)],
)

export const topic_mastery = pgTable(
  'topic_mastery',
  {
    id: text('id').primaryKey().$defaultFn(() => generateId()),
    domain_id: text('domain_id').notNull(),
    topic_id: text('topic_id').notNull(),
    pack_version: text('pack_version').notNull(),
    score: numeric('score').notNull(),
    level_band: text('level_band').notNull(),
    confidence: numeric('confidence').notNull(),
    evidence_summary: jsonb('evidence_summary').notNull(),
    owner_user_id: ownerUserId(),
    ...timestamps,
  },
  (table) => [index('topic_mastery_owner_idx').on(table.owner_user_id)],
)

export const activities = pgTable(
  'activities',
  {
    id: text('id').primaryKey().$defaultFn(() => generateId()),
    domain_id: text('domain_id').notNull(),
    topic_id: text('topic_id').notNull(),
    pack_version: text('pack_version').notNull(),
    level: text('level').notNull(),
    format: text('format').notNull(),
    prompt: text('prompt').notNull(),
    starter_assets: jsonb('starter_assets').notNull(),
    rubric: jsonb('rubric').notNull(),
    status: text('status').notNull(),
    owner_user_id: ownerUserId(),
    ...timestamps,
  },
  (table) => [index('activities_owner_idx').on(table.owner_user_id)],
)

export const attempts = pgTable(
  'attempts',
  {
    id: text('id').primaryKey().$defaultFn(() => generateId()),
    activity_id: text('activity_id').notNull(),
    response: jsonb('response').notNull(),
    execution_result: jsonb('execution_result').notNull(),
    score: numeric('score').notNull(),
    hint_count: integer('hint_count').notNull(),
    feedback: jsonb('feedback').notNull(),
    completion_state: text('completion_state').notNull(),
    owner_user_id: ownerUserId(),
    ...timestamps,
  },
  (table) => [index('attempts_owner_idx').on(table.owner_user_id)],
)

export const learning_events = pgTable(
  'learning_events',
  {
    id: text('id').primaryKey().$defaultFn(() => generateId()),
    event_type: text('event_type').notNull(),
    domain_id: text('domain_id').notNull(),
    topic_id: text('topic_id').notNull(),
    evidence: jsonb('evidence').notNull(),
    score_delta: numeric('score_delta').notNull(),
    confidence_delta: numeric('confidence_delta').notNull(),
    owner_user_id: ownerUserId(),
    ...timestamps,
  },
  (table) => [index('learning_events_owner_idx').on(table.owner_user_id)],
)

export const study_sessions = pgTable(
  'study_sessions',
  {
    id: text('id').primaryKey().$defaultFn(() => generateId()),
    duration_seconds: integer('duration_seconds').notNull(),
    outcomes: jsonb('outcomes').notNull(),
    recap: text('recap').notNull(),
    owner_user_id: ownerUserId(),
    ...timestamps,
  },
  (table) => [index('study_sessions_owner_idx').on(table.owner_user_id)],
)

export const recommendations = pgTable(
  'recommendations',
  {
    id: text('id').primaryKey().$defaultFn(() => generateId()),
    activity_id: text('activity_id').notNull(),
    activity_metadata: jsonb('activity_metadata').notNull(),
    rationale: text('rationale').notNull(),
    status: text('status').notNull(),
    owner_user_id: ownerUserId(),
    ...timestamps,
  },
  (table) => [index('recommendations_owner_idx').on(table.owner_user_id)],
)

export const assessment_sessions = pgTable(
  'assessment_sessions',
  {
    id: text('id').primaryKey().$defaultFn(() => generateId()),
    mode: text('mode').notNull(),
    topic_coverage: jsonb('topic_coverage').notNull(),
    timing_policy: jsonb('timing_policy').notNull(),
    score: numeric('score').notNull(),
    confidence: numeric('confidence').notNull(),
    mastery_impact: jsonb('mastery_impact').notNull(),
    status: text('status').notNull(),
    owner_user_id: ownerUserId(),
    ...timestamps,
  },
  (table) => [index('assessment_sessions_owner_idx').on(table.owner_user_id)],
)

export const assessment_items = pgTable(
  'assessment_items',
  {
    id: text('id').primaryKey().$defaultFn(() => generateId()),
    session_id: text('session_id').notNull(),
    blueprint_id: text('blueprint_id').notNull(),
    blueprint_version: text('blueprint_version').notNull(),
    generated_question: jsonb('generated_question').notNull(),
    difficulty_factors: jsonb('difficulty_factors').notNull(),
    validation_evidence: jsonb('validation_evidence').notNull(),
    answer_rules: jsonb('answer_rules').notNull(),
    review_snapshot: jsonb('review_snapshot').notNull(),
    owner_user_id: ownerUserId(),
    ...timestamps,
  },
  (table) => [index('assessment_items_owner_idx').on(table.owner_user_id)],
)

export const assessment_responses = pgTable(
  'assessment_responses',
  {
    id: text('id').primaryKey().$defaultFn(() => generateId()),
    item_id: text('item_id').notNull(),
    session_id: text('session_id').notNull(),
    selected_answers: jsonb('selected_answers').notNull(),
    justification: text('justification').notNull(),
    response_time_ms: integer('response_time_ms').notNull(),
    partial_credit: numeric('partial_credit').notNull(),
    feedback: jsonb('feedback').notNull(),
    challenge_state: text('challenge_state').notNull(),
    mastery_evidence: jsonb('mastery_evidence').notNull(),
    owner_user_id: ownerUserId(),
    ...timestamps,
  },
  (table) => [index('assessment_responses_owner_idx').on(table.owner_user_id)],
)

// Lessons are generic per topic, so this cache is shared by all learners (no owner column).
export const topic_lessons = pgTable(
  'topic_lessons',
  {
    id: text('id').primaryKey().$defaultFn(() => generateId()),
    domain_id: text('domain_id').notNull(),
    topic_id: text('topic_id').notNull(),
    kind: text('kind').notNull(),
    content: jsonb('content').notNull(),
    model: text('model').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('topic_lessons_topic_kind_idx').on(table.domain_id, table.topic_id, table.kind)],
)
