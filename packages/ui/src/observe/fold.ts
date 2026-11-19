/**
 * State at a time t, read from the history alone: fold the paired messages and the deployments, in seq order, up to
 * the last entry with `at ≤ t`. Nothing re-runs. A message counts with its outcome, even one recorded after t.
 *
 *   await foldAt(store, t, { initial: 0, step: (n, m) => n + (m.outcome?.type === 'delivered' && m.outcome.ok ? 1 : 0) })
 */
import type { AppDeployment } from '@pritzlaff/nano-core'
import { pair, type Message, type MessageStore } from './entry.ts'

/** `step` gets every message (its outcome, if any, attached); `deployment` each deployment entry, the clean start first. */
export async function foldAt<S>(store: MessageStore, t: number, r: { initial: S; step(s: S, m: Message): S; deployment?(s: S, d: AppDeployment): S }): Promise<S> {
  await store.flush()
  const entries = await store.range()
  const last = entries.findLast(e => e.at <= t)?.seq ?? -Infinity
  const messages = new Map(pair(entries).map(m => [m.seq, m]))
  let s = r.initial
  for (const e of entries) {
    if (e.seq > last) break
    const m = messages.get(e.seq)
    if (m) s = r.step(s, m)
    else if (e.event.type === 'deployment' && r.deployment) s = r.deployment(s, e.event.deployment)
  }
  return s
}
