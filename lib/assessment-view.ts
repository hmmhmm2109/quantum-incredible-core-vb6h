import type { GeneratedAssessment, JsonRecord } from '@/lib/app-types'
import type { AssessmentQuestion } from '@/app/sections/practice-section'
import { itemSlot } from '@/lib/assessment-slots'
import { arrayValue, isRecord, normalizeQuestion, nullableString, numberValue, recordValue, stringValue } from '@/lib/normalize'
import { SAMPLE_DOMAINS } from '@/lib/sample-data'

// One entry per unique topic, in slot order: weight = number of questions, subtopics = the angle each slot covers (empty for sessions stored before subtopics were kept), slots = those question slots (same order as subtopics).
export function buildAssessmentCoverage(sampleData: boolean, generated: GeneratedAssessment | null, assessmentSession: JsonRecord | undefined) {
  if (sampleData && !generated) return SAMPLE_DOMAINS.map((domain, index) => ({ domain_id: domain.id, topic_id: domain.focus.toLowerCase().replaceAll(' ', '-'), weight: 1, subtopics: [] as string[], slots: [index] }))
  const raw = generated ? generated.coverage : arrayValue(assessmentSession?.topic_coverage).filter(isRecord).map((item) => ({ domain_id: stringValue(item.domain_id), topic_id: stringValue(item.topic_id), weight: numberValue(item.weight), subtopic: stringValue(item.subtopic) }))
  const merged: { domain_id: string; topic_id: string; weight: number; subtopics: string[]; slots: number[] }[] = []
  raw.forEach((item, index) => {
    const subtopic = item.subtopic || stringValue(recordValue(generated?.items.find((entry) => itemSlot(entry) === index)?.generated_question).topic)
    const existing = merged.find((entry) => entry.domain_id === item.domain_id && entry.topic_id === item.topic_id)
    if (existing) { existing.weight += item.weight || 1; existing.slots.push(index); if (subtopic) existing.subtopics.push(subtopic) } else merged.push({ domain_id: item.domain_id, topic_id: item.topic_id, weight: item.weight || 1, subtopics: subtopic ? [subtopic] : [], slots: [index] })
  })
  return merged
}

// The question on screen is read straight from generated.items at the displayed index, never from a filtered copy, so stem and options always come from the same item.
export function selectGeneratedQuestion(generated: GeneratedAssessment, index: number): AssessmentQuestion | null {
  return normalizeQuestion(generated.items[Math.min(index, generated.items.length - 1)])
}

// Which question is on screen and which slots are done, so the session-wide coverage can show where the learner is.
export function buildAssessmentProgress(generated: GeneratedAssessment | null, currentSlot: number, answeredIds: Set<string>) {
  if (!generated) return null
  const question = recordValue(generated.items.find((item) => itemSlot(item) === currentSlot)?.generated_question)
  const planned = generated.coverage[currentSlot]
  return {
    slot: currentSlot,
    domain_id: stringValue(question.domain_id, planned?.domain_id ?? ''),
    topic_id: stringValue(question.topic_id, planned?.topic_id ?? ''),
    subtopic: stringValue(question.topic, planned?.subtopic ?? ''),
    answeredSlots: generated.items.filter((item) => answeredIds.has(stringValue(item.id))).map(itemSlot),
  }
}

export function buildAssessmentMeta(sampleData: boolean, generated: GeneratedAssessment | null, assessmentIndex: number, assessmentSession: JsonRecord | undefined, assessmentItems: JsonRecord[]) {
  if (generated) { const item = generated.items[Math.min(assessmentIndex, generated.items.length - 1)]; const rules = recordValue(item?.answer_rules); const difficulty = recordValue(item?.difficulty_factors); return { mode: 'knowledge_check', blueprint_id: nullableString(item?.blueprint_id), blueprint_version: nullableString(item?.blueprint_version), calibrated_difficulty: { score: numberValue(difficulty.score, 3) }, validation_state: stringValue(recordValue(item?.validation_evidence).state, 'model_generated').replaceAll('_', ' '), answer_rules: { type: stringValue(rules.type, 'single_answer'), partial_credit: stringValue(rules.partial_credit) }, mastery_impact_cap: { max_level_band_delta: 1, max_score_delta: 8 } } } if (sampleData) return { mode: 'knowledge_check', blueprint_id: 'mixed-diagnostic-v1', blueprint_version: 'v1.0.0', calibrated_difficulty: { score: 2 }, validation_state: 'valid', answer_rules: { type: 'single_answer', partial_credit: 'Written reasoning contributes confidence, not answer-key credit.' }, mastery_impact_cap: { max_level_band_delta: 1, max_score_delta: 8 } }; const item = assessmentItems[0]; const rules = recordValue(item?.answer_rules); return { mode: stringValue(assessmentSession?.mode, 'knowledge_check'), blueprint_id: nullableString(item?.blueprint_id), blueprint_version: nullableString(item?.blueprint_version), calibrated_difficulty: { score: numberValue(recordValue(item?.difficulty_factors).score, 2) }, validation_state: stringValue(recordValue(item?.validation_evidence).state, 'pending'), answer_rules: { type: stringValue(rules.type, 'single_answer'), partial_credit: stringValue(rules.partial_credit) }, mastery_impact_cap: { max_level_band_delta: 1, max_score_delta: 8 } }
}
