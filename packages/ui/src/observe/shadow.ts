/**
 * State at a time t, exactly: a private app built from the recording's clean start and replayed to the last entry with
 * `at ≤ t`, at `pace: 'fast'` with no recorder. Every message its last input set off has finished. The caller reads
 * and closes it. It assumes what replay does (see replay.ts): it is exact only for an app whose pods are deterministic
 * given their inputs, e.g. on a simulated clock and a seeded random.
 *
 *   const app = await shadowAt(host.history, t, d => Application.create(AppDeployment.assemble(d, registry).value, {}))
 */
import type { AppDeployment, Application, NanoResult } from '@pritzlaff/nano-core'
import { failure } from '@pritzlaff/nano-core'
import type { Entry, MessageStore } from './entry.ts'
import { memoryStore } from './memory-store.ts'
import { cleanStart, replay } from './replay.ts'

/** `d` without the pod `host`: not placed, not wired, no tags. */
function without(d: AppDeployment, host: string): AppDeployment {
  const out = structuredClone(d)
  delete out.pods[host]; delete out.tags?.[host]
  for (const r of Object.values(out.runtimes)) {
    r.pods = r.pods.filter(p => p !== host)
    r.subscriptions = r.subscriptions.filter(s => s.from !== host && s.to !== host)
  }
  return out
}

/**
 * `create` builds an app from a deployment (the host's registry and isolation). The shadow leaves out the pod
 * `opts.host` (default `'ui'`, the host's own) and the host's inputs addressed to it. Refuses with `not-found` when the
 * clean start is gone or no entry is at or before t; a replay that fails closes the app and returns its failure.
 */
export async function shadowAt(store: MessageStore, t: number, create: (d: AppDeployment) => Promise<NanoResult<Application>>, opts: { host?: string } = {}): Promise<NanoResult<Application>> {
  const host = opts.host ?? 'ui'
  const start = await cleanStart(store)
  if (!start) return failure('not-found', 'the recording no longer holds a clean start')
  const all = await store.range(), last = all.findLast(e => e.at <= t)
  if (!last) return failure('not-found', `the recording starts after ${t}`)
  const copy = memoryStore({ max: Infinity }), dropped = new Set<string>()
  for (const e of all) {
    if (e.seq > last.seq) break
    const kept = shadowed(e, host, dropped)
    if (kept) copy.append(kept)
  }
  const made = await create(without(start.event.deployment, host))
  if (!made.ok) return made
  const r = await replay(made.value, copy, { pace: 'fast' })
  if (!r.ok) { await made.value.close(); return r }
  return made
}

/** The entry as the shadow sees it: deployments without `host`; the host's sends to `host`, its restarts and their outcomes gone. */
function shadowed(e: Entry, host: string, dropped: Set<string>): Entry | undefined {
  const ev = e.event
  if (ev.type === 'deployment') return { ...e, event: { ...ev, deployment: without(ev.deployment, host) } }
  if (ev.type === 'sent' && ev.from === 'host' && ev.to === host) { dropped.add(ev.id); return undefined }
  if ((ev.type === 'delivered' || ev.type === 'denied') && dropped.has(ev.id)) return undefined
  if (ev.type === 'restarted' && ev.pod === host) return undefined
  return e
}
