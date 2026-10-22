import type { PracticeActivity, AssessmentQuestion } from '@/app/sections/practice-section'
import type { ReviewData } from '@/app/sections/result-section'
import type { ClaudeState, JsonRecord } from '@/lib/app-types'

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function hasOwn(value: JsonRecord, key: string) { return Object.prototype.hasOwnProperty.call(value, key) }
export function stringValue(value: unknown, fallback = '') { return typeof value === 'string' ? value : fallback }
export function nullableString(value: unknown) { return typeof value === 'string' || value === null ? value : null }
// Postgres `numeric` columns (score, confidence, deltas) reach the browser as strings such as "40"; accept those as numbers.
export function numberValue(value: unknown, fallback = 0) { const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value; return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback }
export function nullableNumber(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : value === null ? null : null }
export function recordValue(value: unknown): JsonRecord { return isRecord(value) ? value : {} }
export function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
export function displayNameFromUser(user: unknown) { const record = recordValue(user); const name = stringValue(record.name); return name || stringValue(record.email).split('@')[0] || 'Learner' }
export function displayEmailFromUser(user: unknown) { return stringValue(recordValue(user).email, 'Account email unavailable') }

export function normalizeActivity(raw: unknown): PracticeActivity | null {
  if (!isRecord(raw)) return null
  const execution = recordValue(raw.execution_profile)
  return {
    id: nullableString(raw.id), domain_id: nullableString(raw.domain_id), topic_id: nullableString(raw.topic_id), domain: nullableString(raw.domain), topic: nullableString(raw.topic), pack_version: nullableString(raw.pack_version), level_band: nullableString(raw.level_band), format: nullableString(raw.format),
    prerequisites: arrayValue(raw.prerequisites).filter((value): value is string => typeof value === 'string'), estimated_duration_minutes: numberValue(raw.estimated_duration_minutes, 15), learning_objectives: arrayValue(raw.learning_objectives).filter((value): value is string => typeof value === 'string'), prompt: nullableString(raw.prompt), constraints: arrayValue(raw.constraints).filter((value): value is string => typeof value === 'string'),
    starter_files: arrayValue(raw.starter_files).filter(isRecord).map((file) => ({ path: stringValue(file.path, 'starter-file'), content: stringValue(file.content) })),
    execution_profile: { runtime: stringValue(execution.runtime, 'none'), language: nullableString(execution.language), allowed_actions: arrayValue(execution.allowed_actions).filter((value): value is string => typeof value === 'string'), time_limit_seconds: numberValue(execution.time_limit_seconds), network: stringValue(execution.network, 'unavailable') },
    test_plan: arrayValue(raw.test_plan).filter(isRecord).map((test) => ({ name: stringValue(test.name, 'Test'), purpose: stringValue(test.purpose), visibility: stringValue(test.visibility, 'public') })),
    rubric: arrayValue(raw.rubric).filter(isRecord).map((criterion) => ({ criterion: stringValue(criterion.criterion, 'Criterion'), weight: numberValue(criterion.weight), evidence: stringValue(criterion.evidence) })),
  }
}

export function normalizeQuestion(raw: unknown): AssessmentQuestion | null {
  if (!isRecord(raw)) return null
  const generated = recordValue(raw.generated_question)
  const options = arrayValue(generated.options).filter((value): value is string => typeof value === 'string')
  const stem = stringValue(generated.stem)
  if (!stem || options.length === 0) return null
  return { stem, options, type: stringValue(generated.type, 'single_answer'), artifact: nullableString(generated.artifact) }
}

export function normalizeCoachResult(raw: unknown, envelopeMetadata?: unknown): ReviewData | null {
  if (!isRecord(raw)) return null
  const required = ['request_type', 'activity', 'feedback', 'hints', 'lecture', 'assessment', 'mastery_evidence', 'recommended_next_activity', 'learner_explanation', 'claude_cli']
  if (!required.every((key) => hasOwn(raw, key))) return null
  const feedbackRaw = recordValue(raw.feedback)
  const activityRaw = recordValue(raw.activity)
  const lectureRaw = recordValue(raw.lecture)
  const assessmentRaw = recordValue(raw.assessment)
  const claudeRaw = recordValue(raw.claude_cli)
  const metadataRaw = isRecord(raw.metadata) ? raw.metadata : recordValue(envelopeMetadata)
  const correctnessRaw = recordValue(feedbackRaw.correctness)
  const reasoningRaw = recordValue(feedbackRaw.reasoning_evaluation)
  const answerRulesRaw = recordValue(assessmentRaw.answer_rules)
  const scoreRaw = recordValue(assessmentRaw.score)
  const capRaw = recordValue(assessmentRaw.mastery_impact_cap)
  const executionRaw = recordValue(activityRaw.execution_profile)
  if (!isRecord(raw.activity) || !isRecord(raw.feedback) || !isRecord(raw.lecture) || !isRecord(raw.assessment) || !isRecord(raw.claude_cli)) return null
  if (!Array.isArray(feedbackRaw.findings) || !Array.isArray(feedbackRaw.public_test_feedback) || !Array.isArray(feedbackRaw.safety_findings) || !Array.isArray(raw.hints) || !Array.isArray(lectureRaw.learning_objectives) || !Array.isArray(lectureRaw.sections) || !Array.isArray(lectureRaw.recap) || !Array.isArray(assessmentRaw.topic_coverage) || !Array.isArray(assessmentRaw.review) || !Array.isArray(raw.mastery_evidence)) return null
  const normalizedActivity = normalizeActivity(activityRaw)
  if (!normalizedActivity) return null
  const findingList = feedbackRaw.findings.filter(isRecord).map((finding) => ({ category: stringValue(finding.category, 'conceptual'), severity: stringValue(finding.severity, 'info'), message: stringValue(finding.message), evidence: stringValue(finding.evidence) }))
  const publicTests = feedbackRaw.public_test_feedback.filter(isRecord).map((test) => ({ name: stringValue(test.name, 'Test'), status: stringValue(test.status, 'skipped'), details: stringValue(test.details) }))
  const hints = raw.hints.filter(isRecord).map((hint) => ({ stage: numberValue(hint.stage), label: stringValue(hint.label), content: stringValue(hint.content), revealed: hint.revealed === true }))
  const lectureSections = lectureRaw.sections.filter(isRecord).map((section) => ({ title: stringValue(section.title, 'Lesson section'), content: stringValue(section.content), example: nullableString(section.example), debugging_method: nullableString(section.debugging_method), added_from_questions: Array.isArray(section.added_from_questions) ? section.added_from_questions.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [] }))
  const coverage = assessmentRaw.topic_coverage.filter(isRecord).map((topic) => ({ domain_id: stringValue(topic.domain_id), topic_id: stringValue(topic.topic_id), weight: numberValue(topic.weight) }))
  const review = assessmentRaw.review.filter(isRecord).map((item) => ({ item_id: stringValue(item.item_id), topic_id: stringValue(item.topic_id), valid: item.valid === true, explanation: stringValue(item.explanation), misconception: nullableString(item.misconception) }))
  const mastery = raw.mastery_evidence.filter(isRecord).map((item) => ({ domain_id: stringValue(item.domain_id), topic_id: stringValue(item.topic_id), level_band: stringValue(item.level_band, 'Basic'), score: numberValue(item.score), confidence: numberValue(item.confidence), evidence: arrayValue(item.evidence).filter((line): line is string => typeof line === 'string'), recommended_focus: stringValue(item.recommended_focus) }))
  const changedFiles = arrayValue(claudeRaw.changed_files).filter(isRecord).map((file) => ({ path: stringValue(file.path, 'unknown'), change: stringValue(file.change) }))
  return {
    activity: normalizedActivity, request_type: stringValue(raw.request_type, 'unknown'), activitySummary: stringValue(activityRaw.prompt, 'Activity response'),
    feedback: { summary: stringValue(feedbackRaw.summary), findings: findingList, public_test_feedback: publicTests, hidden_test_summary: nullableString(feedbackRaw.hidden_test_summary), correctness: { score: numberValue(correctnessRaw.score), max_score: numberValue(correctnessRaw.max_score), confidence: numberValue(correctnessRaw.confidence) }, reasoning_evaluation: { score: numberValue(reasoningRaw.score), max_score: numberValue(reasoningRaw.max_score), summary: stringValue(reasoningRaw.summary) }, safety_findings: feedbackRaw.safety_findings.filter((line): line is string => typeof line === 'string') },
    hints, lecture: { selected_depth: stringValue(lectureRaw.selected_depth, 'none'), estimated_duration_minutes: numberValue(lectureRaw.estimated_duration_minutes), selection_reason: stringValue(lectureRaw.selection_reason), learning_objectives: lectureRaw.learning_objectives.filter((line): line is string => typeof line === 'string'), sections: lectureSections, common_failure_mode: nullableString(lectureRaw.common_failure_mode), recap: lectureRaw.recap.filter((line): line is string => typeof line === 'string'), retrieval_check: { prompt: nullableString(recordValue(lectureRaw.retrieval_check).prompt), answer_rule: nullableString(recordValue(lectureRaw.retrieval_check).answer_rule) }, transfer_exercise: { prompt: nullableString(recordValue(lectureRaw.transfer_exercise).prompt), format: nullableString(recordValue(lectureRaw.transfer_exercise).format) } },
    assessment: { mode: stringValue(assessmentRaw.mode, 'none'), blueprint_id: nullableString(assessmentRaw.blueprint_id), blueprint_version: nullableString(assessmentRaw.blueprint_version), topic_coverage: coverage, calibrated_difficulty: { score: numberValue(recordValue(assessmentRaw.calibrated_difficulty).score), factors: arrayValue(recordValue(assessmentRaw.calibrated_difficulty).factors).filter((line): line is string => typeof line === 'string') }, difficulty_rationale: arrayValue(assessmentRaw.difficulty_rationale ?? recordValue(assessmentRaw.calibrated_difficulty).factors).filter((line): line is string => typeof line === 'string'), validation_state: stringValue(assessmentRaw.validation_state, 'none'), answer_rules: { type: stringValue(answerRulesRaw.type, 'none'), partial_credit: stringValue(answerRulesRaw.partial_credit) }, score: { earned: numberValue(scoreRaw.earned), possible: numberValue(scoreRaw.possible), confidence: numberValue(scoreRaw.confidence) }, mastery_impact_cap: { max_level_band_delta: numberValue(capRaw.max_level_band_delta), max_score_delta: numberValue(capRaw.max_score_delta) }, review },
    mastery_evidence: mastery, recommended_next_activity: (() => { const next = recordValue(raw.recommended_next_activity); return { domain_id: nullableString(next.domain_id), topic_id: nullableString(next.topic_id), format: nullableString(next.format), level_band: nullableString(next.level_band), reason: stringValue(next.reason), estimated_duration_minutes: numberValue(next.estimated_duration_minutes) } })(), learner_explanation: stringValue(raw.learner_explanation), claude_cli: { available: claudeRaw.available === true, status: stringValue(claudeRaw.status, 'unavailable'), notice: stringValue(claudeRaw.notice), job_id: nullableString(claudeRaw.job_id), exit_code: nullableNumber(claudeRaw.exit_code), stdout: stringValue(claudeRaw.stdout), stderr: stringValue(claudeRaw.stderr), changed_files: changedFiles }, metadata: { agent_name: stringValue(metadataRaw.agent_name, 'Embedded Systems Learning Coach'), timestamp: stringValue(metadataRaw.timestamp), request_id: nullableString(metadataRaw.request_id) },
    ...(isRecord(raw.quiz) && { quiz: { type: stringValue(raw.quiz.type, 'single_answer'), artifact: nullableString(raw.quiz.artifact), options: arrayValue(raw.quiz.options).filter((v): v is string => typeof v === 'string'), selected: arrayValue(raw.quiz.selected).filter((v): v is string => typeof v === 'string'), correct: arrayValue(raw.quiz.correct).filter((v): v is string => typeof v === 'string'), confidence: nullableString(raw.quiz.confidence) } }),
    ...(isRecord(raw.mastery_delta) && { mastery_delta: { before: numberValue(raw.mastery_delta.before), after: numberValue(raw.mastery_delta.after), delta: numberValue(raw.mastery_delta.delta), band_before: stringValue(raw.mastery_delta.band_before, 'Basic'), band_after: stringValue(raw.mastery_delta.band_after, 'Basic') } }),
  }
}

export function fallbackClaudeFromReview(review: ReviewData): ClaudeState { return review.claude_cli }
