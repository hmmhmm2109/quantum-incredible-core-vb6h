// In-process single-flight: concurrent calls with the same key share one execution and one result.
// The entry is removed in `finally`, so a rejection reaches every waiter but the next call starts fresh.
// Process-local by design (single-instance app); the DB writes stay idempotent for anything that slips past it.
const inflight = new Map<string, Promise<unknown>>()

export function singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const running = inflight.get(key)
  if (running) return running as Promise<T>
  const promise = (async () => {
    try {
      return await run()
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, promise)
  return promise
}
