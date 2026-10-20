// JSON Schema for the coach's structured result. It mirrors what
// normalizeCoachResult() in app/page.tsx requires, so Claude CLI can only
// return a shape the UI can render. (response_schemas/*.json is not a valid
// JSON Schema, so it cannot be passed to --json-schema.)

type Schema = Record<string, unknown>

const str: Schema = { type: 'string' }
const nstr: Schema = { type: ['string', 'null'] }
const num: Schema = { type: 'number' }
const bool: Schema = { type: 'boolean' }
const strArr: Schema = { type: 'array', items: str }

const obj = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
})
const arr = (items: Schema): Schema => ({ type: 'array', items })

export const COACH_RESULT_SCHEMA: Schema = obj({
  request_type: str,
  activity: obj({
    id: nstr, domain_id: nstr, topic_id: nstr, domain: nstr, topic: nstr, pack_version: nstr, level_band: nstr, format: nstr,
    prerequisites: strArr, estimated_duration_minutes: num, learning_objectives: strArr, prompt: nstr, constraints: strArr,
    starter_files: arr(obj({ path: str, content: str })),
    execution_profile: obj({ runtime: str, language: nstr, allowed_actions: strArr, time_limit_seconds: num, network: str }),
    test_plan: arr(obj({ name: str, purpose: str, visibility: str })),
    rubric: arr(obj({ criterion: str, weight: num, evidence: str })),
  }),
  feedback: obj({
    summary: str,
    findings: arr(obj({ category: str, severity: str, message: str, evidence: str })),
    public_test_feedback: arr(obj({ name: str, status: str, details: str })),
    hidden_test_summary: nstr,
    correctness: obj({ score: num, max_score: num, confidence: num }),
    reasoning_evaluation: obj({ score: num, max_score: num, summary: str }),
    safety_findings: strArr,
  }),
  hints: arr(obj({ stage: num, label: str, content: str, revealed: bool })),
  lecture: obj({
    selected_depth: str, estimated_duration_minutes: num, selection_reason: str, learning_objectives: strArr,
    sections: arr(obj({ title: str, content: str, example: nstr, debugging_method: nstr })),
    common_failure_mode: nstr, recap: strArr,
    retrieval_check: obj({ prompt: nstr, answer_rule: nstr }),
    transfer_exercise: obj({ prompt: nstr, format: nstr }),
  }),
  assessment: obj({
    mode: str, blueprint_id: nstr, blueprint_version: nstr,
    topic_coverage: arr(obj({ domain_id: str, topic_id: str, weight: num })),
    calibrated_difficulty: obj({ score: num, factors: strArr }),
    validation_state: str,
    answer_rules: obj({ type: str, partial_credit: str }),
    score: obj({ earned: num, possible: num, confidence: num }),
    mastery_impact_cap: obj({ max_level_band_delta: num, max_score_delta: num }),
    review: arr(obj({ item_id: str, topic_id: str, valid: bool, explanation: str, misconception: nstr })),
  }),
  mastery_evidence: arr(obj({
    domain_id: str, topic_id: str, level_band: str, score: num, confidence: num, evidence: strArr, recommended_focus: str,
  })),
  recommended_next_activity: obj({
    domain_id: nstr, topic_id: nstr, format: nstr, level_band: nstr, reason: str, estimated_duration_minutes: num,
  }),
  learner_explanation: str,
  claude_cli: obj({
    available: bool, status: str, notice: str, job_id: nstr, exit_code: { type: ['number', 'null'] },
    stdout: str, stderr: str, changed_files: arr(obj({ path: str, change: str })),
  }),
})
