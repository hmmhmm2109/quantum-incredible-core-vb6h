// The practice answer is ONE string (answerText: saved as a draft, sent to the coach, stored in attempts). Edited starter files travel inside it,
// each under a `// === path ===` header line after the free-text approach, so old attempts (plain text) stay valid and nothing else has to change.
const HEADER = /^\/\/ === (.+?) ===$/

export type StarterFileLike = { path: string; content: string }

export function splitAnswer(value: string): { approach: string; files: Record<string, string> } {
  const lines = value.split('\n')
  const approach: string[] = []
  const files: Record<string, string> = {}
  let current: string | null = null
  let buffer: string[] = []
  const flush = () => { if (current !== null) files[current] = buffer.join('\n').replace(/\n$/, ''); buffer = [] }
  for (const line of lines) {
    const match = HEADER.exec(line)
    if (match) { flush(); current = match[1]; continue }
    if (current === null) approach.push(line); else buffer.push(line)
  }
  flush()
  return { approach: approach.join('\n').replace(/\n+$/, ''), files }
}

/** Only files that differ from their starter content are written, so an untouched exercise submits exactly the approach text. */
export function composeAnswer(approach: string, edits: Record<string, string>, starters: StarterFileLike[]): string {
  const changed = starters.filter((file) => edits[file.path] !== undefined && edits[file.path] !== file.content)
  const parts = changed.map((file) => `// === ${file.path} ===\n${edits[file.path]}`)
  return [approach.replace(/\n+$/, ''), ...parts].filter((part, index) => index > 0 || part !== '').join('\n\n')
}
