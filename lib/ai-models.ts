import { execFile } from 'node:child_process'
import { copilotBin, isValidModelId } from '@/lib/ai-settings'

// Model choices offered in Settings (one model per provider is used for every call). Server only.
export type ModelOption = { id: string; label: string }
/** live = read from the provider just now; builtin = fallback copy; aliases = Claude aliases the CLI resolves to the newest model itself. */
export type ModelList = { options: ModelOption[]; source: 'live' | 'builtin' | 'aliases'; updated_at: string }

// The CLI maps each alias to the newest model of its family, so these never go stale. Concrete ids below are only a fallback.
const CLAUDE_ALIASES: ModelOption[] = [
  { id: 'fable', label: 'Fable (latest)' },
  { id: 'opus', label: 'Opus (latest)' },
  { id: 'sonnet', label: 'Sonnet (latest)' },
  { id: 'haiku', label: 'Haiku (latest)' },
]
const CLAUDE_CONCRETE = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1']
const CLAUDE_CACHE_MS = 60 * 60_000
let claudeCached: { at: number; ids: string[] } | null = null

/** Concrete ids from the Anthropic API, only when ANTHROPIC_API_KEY is configured (the CLI login has no list command). Server side, never logged. */
async function liveClaudeIds(): Promise<string[]> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return []
  if (claudeCached && Date.now() - claudeCached.at < CLAUDE_CACHE_MS) return claudeCached.ids
  try {
    const response = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(5_000) })
    const body: unknown = await response.json()
    const data = body && typeof body === 'object' ? (body as { data?: unknown }).data : null
    const ids = Array.isArray(data) ? data.map((item) => (item as { id?: unknown })?.id).filter((id): id is string => isValidModelId(id)) : []
    if (response.ok && ids.length > 0) claudeCached = { at: Date.now(), ids }
    return ids
  } catch { return claudeCached?.ids ?? [] }
}

export async function claudeModels(): Promise<ModelList> {
  const live = await liveClaudeIds()
  const concrete = live.length > 0 ? live : CLAUDE_CONCRETE
  const options = [...CLAUDE_ALIASES, ...concrete.map((id) => ({ id, label: '' }))]
  return { options, source: live.length > 0 ? 'live' : 'aliases', updated_at: new Date(claudeCached?.at ?? Date.now()).toISOString() }
}

// Copy of `copilot help config` (model) for when the CLI is missing or its output cannot be parsed.
const COPILOT_FALLBACK = ['claude-sonnet-5.5', 'claude-sonnet-5', 'claude-fable-5.1', 'claude-fable-5', 'claude-opus-5.5', 'claude-opus-5', 'claude-opus-4.8', 'claude-opus-4.8-fast', 'claude-sonnet-4.6', 'claude-haiku-5.5', 'claude-haiku-4.5', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5-mini', 'mai-code-1.1-flash', 'gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.7-flash', 'grok-4.7', 'grok-4.6', 'grok-4.5', 'kimi-k3']
const CACHE_MS = 10 * 60_000
let cached: { at: number; ids: string[]; live: boolean } | null = null

/** Allowed values of the `model` setting in `copilot help config`: the quoted bullets between "`model`:" and the next setting. */
export function parseCopilotModels(helpText: string): string[] {
  const start = helpText.search(/^\s*`model`:/m)
  if (start < 0) return []
  const lines = helpText.slice(start).trimStart().split('\n').slice(1)
  const ids: string[] = []
  for (const line of lines) {
    const match = /^\s*-\s*"([^"]+)"\s*$/.exec(line)
    if (match) { if (isValidModelId(match[1])) ids.push(match[1]); continue }
    if (/^\s*`/.test(line) || (line.trim() !== '' && !/^\s*-/.test(line))) break
  }
  return ids
}

function readHelp(): Promise<string> {
  return new Promise((resolve) => {
    execFile(copilotBin(), ['help', 'config'], { timeout: 3_000, maxBuffer: 1 << 20, env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' } }, (error, stdout) => resolve(error ? '' : stdout))
  })
}

export async function copilotModels(refresh = false): Promise<ModelList> {
  const list = (ids: string[], source: ModelList['source'], at: number): ModelList => ({ options: ids.map((id) => ({ id, label: '' })), source, updated_at: new Date(at).toISOString() })
  if (!refresh && cached && Date.now() - cached.at < CACHE_MS) return list(cached.ids, cached.live ? 'live' : 'builtin', cached.at)
  const live = parseCopilotModels(await readHelp())
  const ids = live.length > 0 ? live : cached?.ids ?? COPILOT_FALLBACK
  cached = { at: Date.now(), ids, live: live.length > 0 || Boolean(cached?.live) }
  return list(ids, cached.live ? 'live' : 'builtin', cached.at)
}
