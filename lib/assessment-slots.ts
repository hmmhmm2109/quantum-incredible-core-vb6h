import type { JsonRecord } from '@/lib/app-types'
import { numberValue, recordValue } from '@/lib/normalize'

export const itemSlot = (item: JsonRecord) => numberValue(recordValue(item.generated_question).slot, -1)
export const insertBySlot = (items: JsonRecord[], item: JsonRecord) => (items.some((existing) => itemSlot(existing) === itemSlot(item)) ? items : [...items, item].sort((a, b) => itemSlot(a) - itemSlot(b)))
// Next question after `slot`: skips slots that failed (missing), 'wait' while the following slot is still being written, null when nothing is left to show.
export function nextAvailable(gen: { total: number; items: JsonRecord[]; missing: { slot: number }[] }, slot: number): JsonRecord | 'wait' | null {
  for (let next = slot + 1; next < gen.total; next++) {
    const item = gen.items.find((candidate) => itemSlot(candidate) === next)
    if (item) return item
    if (!gen.missing.some((entry) => entry.slot === next)) return 'wait'
  }
  return null
}
