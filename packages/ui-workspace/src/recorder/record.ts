import type { AppEvent, Application } from '@pritzlaff/nano-core'
import { snap, type Entry, type MessageStore, type Recorded } from './entry.ts'

const recorded = (e: AppEvent): Recorded => {
  if (e.type === 'sent') { const { input, ...rest } = e; return 'input' in e ? { ...rest, input: snap(input) } : rest }
  if (e.type === 'delivered') return { type: 'delivered', id: e.id, ok: e.result.ok, result: snap(e.result.ok ? e.result.value : e.result.fail), ms: e.ms }
  return e
}

/**
 * Records `app` into `store` from now: first a deployment entry (the app's current deployment), then every event,
 * snapshotted, with another deployment entry after each `applied`. seq starts after the store's last entry.
 */
export async function record(app: Application, store: MessageStore, now: () => number = Date.now): Promise<() => void> {
  await store.flush()
  const n = await store.size()
  const last = n ? (await store.range((await store.oldest())! + n - 1)).at(-1) : undefined   // read, not trusted
  let seq = last?.seq ?? 0
  const add = (event: Recorded) => { try { store.append({ seq: ++seq, at: now(), event } satisfies Entry) } catch { /* never throws into the app */ } }
  const deployment = () => add({ type: 'deployment', deployment: app.deployment() })
  deployment()
  return app.listen(e => {
    try { add(recorded(e)); if (e.type === 'applied') deployment() } catch { /* never throws into the app */ }
  })
}
