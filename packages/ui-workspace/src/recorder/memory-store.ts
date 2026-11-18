import type { Entry, MessageStore } from './entry.ts'

/** An in-memory MessageStore; past `max` (10000) the oldest entry is dropped. */
export function memoryStore(opts: { max?: number } = {}): MessageStore {
  const max = opts.max ?? 10000
  let all: Entry[] = []
  return {
    append(e) { all.push(e); if (all.length > max) all.shift() },
    flush: async () => {},
    range: async (from = -Infinity, to = Infinity, limit = Infinity) =>
      limit <= 0 ? [] : all.filter(e => e.seq >= from && e.seq <= to).slice(0, limit),
    search: async (text, limit = Infinity) => {
      const t = text.toLowerCase()
      return limit <= 0 ? [] : all.filter(e => JSON.stringify(e.event).toLowerCase().includes(t)).slice(-limit)
    },
    oldest: async () => all[0]?.seq,
    size: async () => all.length,
    clear: async () => { all = [] },
  }
}
