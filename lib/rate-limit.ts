// Fixed-window limiter kept in process memory; enough for one Next.js server, not shared across instances.
const windows = new Map<string, { start: number; count: number }>()

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now()
  const entry = windows.get(key)
  if (!entry || now - entry.start >= windowMs) {
    windows.set(key, { start: now, count: 1 })
    if (windows.size > 1000) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k)
    return { ok: true as const, retryAfterSeconds: 0 }
  }
  entry.count += 1
  if (entry.count > limit) return { ok: false as const, retryAfterSeconds: Math.max(1, Math.ceil((entry.start + windowMs - now) / 1000)) }
  return { ok: true as const, retryAfterSeconds: 0 }
}
