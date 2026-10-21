export const OPTION_COUNT = 4

export type RawQuestion = {
  slot: number
  stem: string
  artifact: string | null
  options: string[]
  correct_indexes: number[]
  explanation: string
  misconception: string
  difficulty_factors: string[]
}

// Options must stand alone: the learner sees them shuffled, so "both A and B" or "option 2" point at nothing.
const CROSS_REFERENCE = /\b(all|none|neither|both) of the above\b|\bboth (A|B|1|2|3|4)\s+and\s+(A|B|1|2|3|4)\b|\boption\s*\(?\d\)?|\bthe (first|second|third|fourth) option\b|\bnone of these\b/i

// A stem that sets design (A) against design (B) is only answerable if the options discuss both.
const hasDesignPair = (stem: string) => /\(A\)/.test(stem) && /\(B\)/.test(stem)

// Text of one named alternative: from its "(X)" label to the next label or the end of the sentence.
function alternativeSegment(stem: string, label: 'A' | 'B') {
  const start = stem.indexOf(`(${label})`)
  if (start < 0) return ''
  const rest = stem.slice(start + 3)
  const end = rest.search(/\([A-B]\)|[.?;\n]/)
  return end < 0 ? rest : rest.slice(0, end)
}

// An option refers to alternative X by label ("(A)", "Design A", "A:", "A,") or by one of the backticked terms the stem used for it.
function mentionsAlternative(option: string, label: 'A' | 'B', terms: string[]) {
  if (new RegExp(`\\(${label}\\)|\\b(design|option|approach|version|variant|choice)\\s+${label}\\b|^${label}\\b(?!\\w)\\s*[:,.)\\-–—]|^${label}$`, 'i').test(option.trim())) return true
  const lower = option.toLowerCase()
  return terms.some((term) => lower.includes(term.toLowerCase()))
}

// Cheap, conservative: returns a problem only when the mismatch is certain; anything ambiguous passes (the optional judge covers it).
export function checkCoherence(stem: string, options: string[]): string | null {
  if (options.some((option) => CROSS_REFERENCE.test(option))) return 'option refers to another option (all of the above, both A and B, option N)'
  if (!hasDesignPair(stem)) return null
  for (const label of ['A', 'B'] as const) {
    const terms = [...alternativeSegment(stem, label).matchAll(/`([^`]+)`/g)].map((match) => match[1])
    if (terms.length === 0) continue // nothing concrete to look for
    if (!options.some((option) => mentionsAlternative(option, label, terms))) return `stem compares designs (A) and (B) but no option mentions design ${label} (${terms.join(', ')})`
  }
  return null
}

// Stems worth one extra judge call: a comparison or tradeoff question is where stem and options drift apart.
export const needsJudge = (stem: string) => hasDesignPair(stem) || /trade-?offs?|which design|best approach|which approach/i.test(stem)

export function validate(raw: RawQuestion, slot: { type: 'single_answer' | 'multiple_answer' }): string | null {
  if (!raw.stem?.trim()) return 'empty stem'
  if (!Array.isArray(raw.options) || raw.options.length !== OPTION_COUNT) return 'wrong option count'
  const trimmed = raw.options.map((option) => option.trim())
  if (trimmed.some((option) => !option) || new Set(trimmed.map((option) => option.toLowerCase())).size !== OPTION_COUNT) return 'blank or duplicate option'
  const correct = [...new Set(raw.correct_indexes)]
  if (correct.some((index) => !Number.isInteger(index) || index < 0 || index >= OPTION_COUNT)) return 'correct index out of range'
  if (slot.type === 'single_answer' && correct.length !== 1) return 'single answer needs exactly one correct option'
  if (slot.type === 'multiple_answer' && (correct.length < 2 || correct.length > 3)) return 'multiple answer needs 2-3 correct options'
  return checkCoherence(raw.stem, trimmed)
}
