import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getCurrentUserId, scopedRepo } from 'lyzr-architect-pg'
import { desc, eq } from 'lyzr-architect-pg/schema'
import { learner_profiles } from '@/lib/db/schema'

// Which AI CLI answers tutor requests. Stored in learner_profiles.preferences (ai_provider, ai_failover);
// env AI_CLI_PROVIDER is the default when the profile has no choice yet. Server only.

export type AiProvider = 'claude' | 'copilot'
export type AiSettings = { provider: AiProvider; failover: boolean }

const CACHE_MS = 5_000
const AVAILABILITY_CACHE_MS = 60_000
const cache = new Map<string, { at: number; value: AiSettings }>()

export const isProvider = (value: unknown): value is AiProvider => value === 'claude' || value === 'copilot'
export const otherProvider = (provider: AiProvider): AiProvider => (provider === 'claude' ? 'copilot' : 'claude')
export const copilotBin = () => process.env.COPILOT_BIN || 'copilot'

export function envDefaultProvider(): AiProvider {
  const value = (process.env.AI_CLI_PROVIDER ?? '').trim().toLowerCase()
  return isProvider(value) ? value : 'claude'
}

const profileRepo = () => scopedRepo(learner_profiles)
const latestProfile = async () => (await profileRepo().findMany({ orderBy: desc(learner_profiles.created_at) }))[0]

function fromPreferences(preferences: unknown): AiSettings {
  const prefs = preferences && typeof preferences === 'object' && !Array.isArray(preferences) ? (preferences as Record<string, unknown>) : {}
  return { provider: isProvider(prefs.ai_provider) ? prefs.ai_provider : envDefaultProvider(), failover: prefs.ai_failover === true }
}

/** Settings of the authenticated learner (cached a few seconds). Falls back to the env default outside a request. */
export async function getAiSettings(): Promise<AiSettings> {
  let userId: string | null = null
  try { userId = getCurrentUserId() ?? null } catch { userId = null }
  const key = userId ?? 'anonymous'
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  let value: AiSettings = { provider: envDefaultProvider(), failover: false }
  if (userId) {
    try {
      const profile = await latestProfile()
      if (profile) value = fromPreferences(profile.preferences)
    } catch (error) {
      console.error('[ai-settings] could not read profile, using default', error instanceof Error ? error.message : error)
    }
  }
  cache.set(key, { at: Date.now(), value })
  return value
}

/** Merges the given fields into the learner's preferences and drops the cache. */
export async function saveAiSettings(update: Partial<AiSettings>): Promise<AiSettings> {
  const profile = await latestProfile()
  const base = profile?.preferences && typeof profile.preferences === 'object' && !Array.isArray(profile.preferences) ? (profile.preferences as Record<string, unknown>) : {}
  const current = fromPreferences(base)
  const next: AiSettings = { provider: update.provider ?? current.provider, failover: update.failover ?? current.failover }
  const preferences = { ...base, ai_provider: next.provider, ai_failover: next.failover }
  if (profile) await profileRepo().update(eq(learner_profiles.id, profile.id), { preferences })
  else await profileRepo().insert({ display_name: 'Learner', preferences, onboarding_state: {} })
  cache.clear()
  return next
}

export type ProviderAvailability = {
  installed: boolean
  version: string | null
  /** copilot only: token env present, a stored login was found, or neither (heuristic, no model call is made). */
  auth?: 'token' | 'logged_in' | 'none'
}
let availability: { at: number; value: Record<AiProvider, ProviderAvailability> } | null = null

function probe(bin: string): Promise<{ installed: boolean; version: string | null }> {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 3_000, env: { ...process.env, TERM: 'dumb', NO_COLOR: '1' } }, (error, stdout) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') return resolve({ installed: false, version: null })
      if (error && !stdout) return resolve({ installed: false, version: null })
      resolve({ installed: true, version: stdout.split('\n')[0]?.trim().slice(0, 80) || null })
    })
  })
}

async function copilotAuth(): Promise<'token' | 'logged_in' | 'none'> {
  if (process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return 'token'
  try {
    const home = process.env.COPILOT_HOME_DIR || join(homedir(), '.copilot')
    const text = await readFile(join(home, 'config.json'), 'utf8')
    if (/"(?:last_logged_in_user|lastLoggedInUser)"\s*:\s*\{/.test(text) || /"(?:logged_in_users|loggedInUsers)"\s*:\s*\[\s*\{/.test(text)) return 'logged_in'
  } catch { /* no config yet */ }
  return 'none'
}

/** Whether each CLI binary runs (`--version`, 3s timeout, cached 60s). Never returns secrets. */
export async function getAvailability(): Promise<Record<AiProvider, ProviderAvailability>> {
  if (availability && Date.now() - availability.at < AVAILABILITY_CACHE_MS) return availability.value
  const [claude, copilot, auth] = await Promise.all([probe('claude'), probe(copilotBin()), copilotAuth()])
  const value = { claude, copilot: { ...copilot, auth } }
  availability = { at: Date.now(), value }
  return value
}
