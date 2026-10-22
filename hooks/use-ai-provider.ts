'use client'

import { useEffect, useSyncExternalStore } from 'react'

// Client-side copy of the active AI provider (server truth: /api/settings/ai). Loaded once by page.tsx,
// updated by the profile card on save, read by any component that names the provider in UI text.
export type AiProviderId = 'claude' | 'copilot'
export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = { claude: 'Claude CLI', copilot: 'Copilot CLI' }

let current: AiProviderId = 'claude'
let currentModel = ''
const listeners = new Set<() => void>()
/** `model` = effective model id of the active provider ('' when it uses the CLI's own default); omit to keep the last one. */
export function publishAiProvider(provider: AiProviderId, model?: string | null) {
  const nextModel = model === undefined ? currentModel : model ?? ''
  if (provider === current && nextModel === currentModel) return
  current = provider
  currentModel = nextModel
  listeners.forEach((listener) => listener())
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/** Display name of the active provider ("Claude CLI" / "Copilot CLI") and its short form ("Claude" / "Copilot"). */
export function useAiProvider() {
  const provider = useSyncExternalStore(subscribe, () => current, () => 'claude' as AiProviderId)
  const model = useSyncExternalStore(subscribe, () => currentModel, () => '')
  const label = AI_PROVIDER_LABELS[provider]
  return { provider, model, label, short: label.replace(' CLI', '') }
}

/** Call once near the root: fetches the saved provider after login. */
export function useLoadAiProvider(authFetch: (url: string, init?: RequestInit) => Promise<Response>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    authFetch('/api/settings/ai').then((response) => response.json()).then((payload) => {
      const value = payload?.data?.provider
      const model = payload?.data?.effective?.[value]?.id
      if (!cancelled && (value === 'claude' || value === 'copilot')) publishAiProvider(value, typeof model === 'string' ? model : null)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [authFetch, enabled])
}

/** Non-hook read for callbacks (toasts, error messages) that run outside render. */
export const getAiProviderShort = () => AI_PROVIDER_LABELS[current].replace(' CLI', '')
