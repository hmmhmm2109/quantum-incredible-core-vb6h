// Retry policy for the client's background question generation: which failures are worth another try, and how long to wait.

export class HttpError extends Error {
  status?: number // undefined for network failures (fetch rejected, body unreadable)
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

export const MAX_ATTEMPTS = 3
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

// 400/401/403/404/409 and other 4xx will not change on a second try; network errors and busy/gateway errors might.
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof HttpError)) return true
  return error.status === undefined || RETRYABLE_STATUSES.has(error.status)
}

// Delay after the failed attempt number `attempt` (0-based): 1s, 3s; "tutor is busy" (429) waits longer: 5s, 10s.
export function retryDelayMs(error: unknown, attempt: number): number {
  const busy = error instanceof HttpError && error.status === 429
  return (busy ? [5_000, 10_000] : [1_000, 3_000])[Math.min(attempt, 1)]
}

/** Runs `run` up to MAX_ATTEMPTS times; throws the last error at once if it is not retryable. */
export async function withRetry<T>(run: () => Promise<T>, sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      if (attempt + 1 >= MAX_ATTEMPTS || !isRetryable(error)) throw error
      await sleep(retryDelayMs(error, attempt))
    }
  }
}
