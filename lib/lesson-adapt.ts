import { createHash } from 'node:crypto'

// Pure helpers for the "enrich the lecture with my questions" flow (POST /api/lesson action 'adapt'):
// whatever the model returns, the stable parts of the lecture are copied from the BASE lecture by code.

export const gapHashOf = (ids: string[]) => createHash('sha1').update([...ids].sort().join(',')).digest('hex').slice(0, 12)

type Rec = Record<string, unknown>
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)
const SECTION_TEXT_KEYS = ['title', 'content', 'example', 'debugging_method'] as const
// Parts of the lecture that must not drift: the checks the learner is graded on, the depth and the objectives.
const STABLE_KEYS = ['selected_depth', 'estimated_duration_minutes', 'learning_objectives', 'retrieval_check', 'transfer_exercise'] as const
// The learner's questions must be woven into the text, never echoed back.
export const QA_STYLE = /\byou (asked|wondered|were (asking|confused))\b|\byour question\b|clarified for you|as you asked/i

export const cleanAdded = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 8) : []
export const sectionsOf = (content: Rec) => { const lecture = content.lecture; return isRec(lecture) && Array.isArray(lecture.sections) ? lecture.sections.filter(isRec) : [] }
const sameText = (a: Rec, b: Rec) => SECTION_TEXT_KEYS.every((key) => (a[key] ?? null) === (b[key] ?? null))

export type FinalizeReport = { touched: number; restored: number[]; padded: number; qaStyle: number[]; stableOverwritten: string[] }

/** Enforces the guarantees on the model's lecture: stable keys come from `base` byte for byte; sections the model did not mark as
 *  touched (empty added_from_questions) are restored from `base` when they differ; missing sections are appended from `base`. */
export function finalizeAdapted(base: Rec, model: Rec): { content: Rec; report: FinalizeReport } {
  const baseLecture = isRec(base.lecture) ? base.lecture : {}
  const modelLecture = isRec(model.lecture) ? model.lecture : {}
  const baseSections = sectionsOf(base)
  const modelSections = sectionsOf(model)
  const report: FinalizeReport = { touched: 0, restored: [], padded: 0, qaStyle: [], stableOverwritten: [] }
  const sections: Rec[] = modelSections.map((section, index) => {
    const added = cleanAdded(section.added_from_questions)
    const original = baseSections[index]
    if (added.length === 0) {
      if (original && !sameText(section, original)) { report.restored.push(index); return { ...original, added_from_questions: [] } }
      return { ...(original ?? section), added_from_questions: [] }
    }
    report.touched += 1
    if (SECTION_TEXT_KEYS.some((key) => typeof section[key] === 'string' && QA_STYLE.test(section[key] as string))) report.qaStyle.push(index)
    return { ...section, added_from_questions: added }
  })
  for (let index = sections.length; index < baseSections.length; index += 1) { sections.push({ ...baseSections[index], added_from_questions: [] }); report.padded += 1 }
  const lecture: Rec = { ...modelLecture, sections }
  for (const key of STABLE_KEYS) {
    if (key in baseLecture) { if (JSON.stringify(modelLecture[key]) !== JSON.stringify(baseLecture[key])) report.stableOverwritten.push(key); lecture[key] = baseLecture[key] }
  }
  return { content: { ...model, lecture }, report }
}

/** The base lecture as the model must see it: no stale added_from_questions. */
export function stripAdded(content: Rec): Rec {
  const lecture = isRec(content.lecture) ? content.lecture : {}
  return { ...content, lecture: { ...lecture, sections: sectionsOf(content).map(({ added_from_questions: _ignored, ...rest }) => rest) } }
}

/** True when the result needs a repair retry. */
export const needsRepair = (report: FinalizeReport, gapCount: number, modelSections: number, baseSections: number) =>
  gapCount > 0 && (report.touched === 0 || report.qaStyle.length > 0 || modelSections < baseSections)

// ---- Per-section enrichment (POST /api/lesson action 'enrich_section') ----

export type EnrichedSection = { content: string; example: string | null; debugging_method: string | null; added_from_questions: string[] }
const SECTION_FIELDS = ['content', 'example', 'debugging_method'] as const

/** True when the rewritten section reads like a normal lecture: non-empty content, no Q&A phrasing, every ``` fence closed. */
export function sectionProblems(section: Partial<EnrichedSection>): string[] {
  const problems: string[] = []
  if (typeof section.content !== 'string' || !section.content.trim()) problems.push('empty content')
  for (const key of SECTION_FIELDS) {
    const text = section[key]
    if (typeof text !== 'string') continue
    if (QA_STYLE.test(text)) problems.push(`${key} addresses the learner`)
    if ((text.match(/```/g)?.length ?? 0) % 2 === 1) problems.push(`${key} has an unclosed code fence`)
  }
  return problems
}

/** Puts the rewritten section at `index` of the stored enriched lecture (or of the base lecture when none exists yet).
 *  Everything else comes from `current`; stable keys (retrieval_check, transfer_exercise, objectives, depth) always come from `base` byte for byte. */
export function spliceSection(base: Rec, current: Rec | null, index: number, baseSection: Rec, enriched: EnrichedSection): Rec {
  const baseLecture = isRec(base.lecture) ? base.lecture : {}
  const baseSections = sectionsOf(base)
  const from = current && sectionsOf(current).length === baseSections.length ? current : base
  const fromLecture = isRec(from.lecture) ? from.lecture : {}
  const sections = sectionsOf(from).map((section) => ({ ...section }))
  sections[index] = { ...baseSection, content: enriched.content, example: enriched.example, debugging_method: enriched.debugging_method, added_from_questions: enriched.added_from_questions }
  const lecture: Rec = { ...fromLecture, sections }
  for (const key of STABLE_KEYS) if (key in baseLecture) lecture[key] = baseLecture[key]
  return { ...from, lecture }
}
