/**
 * The host's history: its app recorded from creation into a `memoryStore()` (100,000 entries), and Reset.
 *
 *   const h = await recording(app)   // h.store: a clean deployment entry, then every message
 *   await h.reset()                  // every pod restarted; the history is one clean deployment entry again
 */
import { success, type Application, type NanoResult } from '@pritzlaff/nano-core'
import { memoryStore, record, replay, type Entry, type MessageStore } from '@pritzlaff/nano-ui'

/** The app's messages since its creation or the last Reset. */
export type History = {
  readonly store: MessageStore
  /** Hears each new entry, across Resets. */
  listen(fn: (e: Entry) => void): () => void
  /** Restarts every pod, empties the history and records afresh from a clean start; works however long the history.
   * A call while one runs shares it. */
  reset(): Promise<NanoResult<void>>
}

export async function recording(app: Application): Promise<History> {
  const store = memoryStore(), heard = new Set<(e: Entry) => void>()
  const begin = async (clean: boolean) => {
    const r = await record(app, store, { clean })
    r.listen(e => { for (const fn of heard) try { fn(e) } catch { /* one listener never stops the others */ } })
    return r
  }
  let rec = await begin(true), pending: Promise<NanoResult<void>> | undefined
  const reset = async (): Promise<NanoResult<void>> => {
    rec.stop()
    // replay's reset (apply the deployment, restart every pod, callees first), over a recording of just this start.
    const now = memoryStore()
    now.append({ seq: 1, at: Date.now(), event: { type: 'deployment', deployment: app.deployment(), clean: true } })
    const r = await replay(app, now)
    if (r.ok) await store.clear()
    rec = await begin(r.ok)   // a failed reset keeps the history and records on, not clean
    return r.ok ? success(undefined) : r
  }
  return {
    store, listen: fn => { heard.add(fn); return () => { heard.delete(fn) } },
    reset: () => pending ??= reset().finally(() => { pending = undefined }),
  }
}
