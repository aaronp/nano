import type { AppEvent, Application } from '@pritzlaff/nano-core'
import { snap, type Entry, type MessageStore, type Recorded } from './entry.ts'

const recorded = (e: AppEvent): Recorded => {
  if (e.type === 'sent') { const { input, ...rest } = e; return 'input' in e ? { ...rest, input: snap(input) } : rest }
  if (e.type === 'delivered') return { type: 'delivered', id: e.id, ok: e.result.ok, result: snap(e.result.ok ? e.result.value : e.result.fail), ms: e.ms }
  return e
}

/**
 * Records `app` into `store` from now: first a deployment entry (the app's current deployment, `clean: true` when
 * `opts.clean` says its pods hold no state yet), then every event, snapshotted, with another deployment entry after each
 * `applied`. It listens before reading the store's last seq and holds what arrives meanwhile, so nothing is missed.
 * seq starts after the store's last entry; resolves to `stop` and `listen(fn)`, which hears each entry once appended, in order, and returns its unsubscribe; `at` is `opts.now()` (`Date.now`).
 */
export async function record(app: Application, store: MessageStore, opts: { clean?: boolean; now?: () => number } = {}): Promise<{ stop: () => void; listen: (fn: (e: Entry) => void) => () => void }> {
  const now = opts.now ?? Date.now
  let seq = 0
  const heard = new Set<(e: Entry) => void>()
  let held: { at: number; event: Recorded }[] | undefined = []
  const add = (event: Recorded, at = now()) => {
    try { if (held) held.push({ at, event }); else { const entry: Entry = { seq: ++seq, at, event }; store.append(entry); for (const fn of heard) try { fn(entry) } catch { /* a listener never breaks recording */ } } } catch { /* never throws into the app */ }
  }
  const deployment = (clean?: boolean, caller?: string) => add({ type: 'deployment', deployment: app.deployment(), ...(clean ? { clean: true as const } : {}), ...(caller ? { caller } : {}) })
  deployment(opts.clean)
  const stop = app.listen(e => {
    try { add(recorded(e)); if (e.type === 'applied') deployment(false, e.caller) } catch { /* never throws into the app */ }
  })
  try {
    await store.flush()
    const n = await store.size()
    seq = n ? (await store.range((await store.oldest())! + n - 1)).at(-1)?.seq ?? 0 : 0   // read, not trusted
  } catch (e) { stop(); throw e }   // a store that can't be read records nothing
  const waiting = held; held = undefined
  for (const { at, event } of waiting) add(event, at)
  return { stop, listen: fn => { heard.add(fn); return () => { heard.delete(fn) } } }
}
