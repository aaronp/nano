/**
 * What the recorder keeps: entries (an app event, values snapshotted as JSON text), messages (a sent paired with its
 * outcome) and the swappable async store behind them.
 *
 *   snap({ n: 10n })                       // '{"n":"10n"}'
 *   pair(await store.range())              // Message[], in sent order
 */
import type { AppDeployment, AppEvent } from '@pritzlaff/nano-core'

/** A recorded thing: an app event (values snapshotted as JSON text), or the deployment in force from here on (`clean`: its pods held no state). */
export type Recorded =
  | (Exclude<AppEvent, { type: 'sent' | 'delivered' }>)
  | (Omit<Extract<AppEvent, { type: 'sent' }>, 'input'> & { input?: string })
  | { type: 'delivered'; id: string; ok: boolean; result: string; ms: number }
  | { type: 'deployment'; deployment: AppDeployment; clean?: true }

export type Entry = { seq: number; at: number; event: Recorded }

export const CAP = 65536
const MARK = '…truncated'

/** Safe JSON text of any value: never throws, cycles, BigInts and functions are marked, capped at CAP. */
export function snap(v: unknown): string {
  const stack: unknown[] = []
  let text: string
  try {
    text = String(JSON.stringify(v, function (this: unknown, _k, x) {
      if (typeof x === 'bigint') return `${x}n`
      if (typeof x === 'function') return '[function]'
      if (x !== null && typeof x === 'object') {
        while (stack.length && stack[stack.length - 1] !== this) stack.pop() // back up to the holder: only ancestors count
        if (stack.includes(x)) return '[cycle]'
        stack.push(x)
      }
      return x
    }))
  } catch { text = '"[unserializable]"' }
  return text.length > CAP ? text.slice(0, CAP) + MARK : text
}

export const truncated = (text: string): boolean => text.endsWith(MARK)

/** A message: its sent, and its outcome once known. */
export type Message = { seq: number; at: number; sent: Extract<Recorded, { type: 'sent' }>; outcome?: Extract<Recorded, { type: 'delivered' }> | Extract<Recorded, { type: 'denied' }> }

/** Messages in sent order; an outcome without its sent is skipped. */
export function pair(entries: Entry[]): Message[] {
  const byId = new Map<string, Message>()
  const out: Message[] = []
  for (const { seq, at, event } of entries) {
    if (event.type === 'sent') { const m: Message = { seq, at, sent: event }; byId.set(event.id, m); out.push(m) }
    else if (event.type === 'delivered' || event.type === 'denied') { const m = byId.get(event.id); if (m) m.outcome = event }
  }
  return out
}

/**
 * Seqs are contiguous (one writer per store assigns them: two tabs on one store is out of scope; a store drops only from
 * the oldest end). After `flush()`, `size`/`oldest`/`range` include every appended entry; `flush()` rejects when
 * buffered writes failed. `range(from, to, limit)` is inclusive and keeps at most `limit`, from the `from` end.
 * `search` matches the entry's JSON text, deployment entries too, and keeps the newest `limit` matches, oldest first.
 */
export interface MessageStore {
  append(e: Entry): void
  flush(): Promise<void>
  range(from?: number, to?: number, limit?: number): Promise<Entry[]>
  search(text: string, limit?: number): Promise<Entry[]>
  oldest(): Promise<number | undefined>
  size(): Promise<number>
  clear(): Promise<void>
}
