/**
 * A pod started explicitly, in one runtime (ADR-0031). `start(pod)` is a message of kind `start` from the host, with no
 * port: `sent`, asked of the runtime's policy, then `delivered` with the build's result (or `denied`). It builds through
 * `live.instance`, the one build per pod however many ask. `getOrCreate(pod)` reuses a running pod, or starts it, and
 * gives `call(pod)`'s client. Of callers racing on one pod in one runtime, one starts it; the rest find it started once it settles.
 *
 *   const s = starter(live, at, status, call)
 *   await s.start('db')         // NanoResult<void>: not-found, invalid-input "already running", denied, or the build's Fail
 *   await s.getOrCreate('db')   // NanoResult<{ started, pod }>
 */
import { failure, success, type Fail, type NanoResult } from '../result.ts'
import type { client } from './emit.ts'
import type { PodStatus } from './instances.ts'
import { lookup } from './lookup.ts'
import { refusal, type Live } from './messages.ts'

type Client = ReturnType<typeof client>
type At = () => { ok: true; value: string } | { ok: false; fail: Fail }

/** Starts under way, by application and `runtime|pod`: a caller in another runtime is asked its own policy (the build is still one per pod). */
const pending = new WeakMap<Live, Map<string, Promise<NanoResult<void>>>>()

export function starter(live: Live, at: At, status: (pod: string) => PodStatus, call: (pod: string) => Client) {
  const under = pending.get(live) ?? new Map<string, Promise<NanoResult<void>>>()
  pending.set(live, under)

  /** The message itself: sent, policed, the build, delivered. */
  async function send(runtime: string, pod: string): Promise<NanoResult<void>> {
    const id = live.trace.id()
    live.trace.emit({ type: 'sent', id, runtime, kind: 'start', from: 'host', to: pod, correlation: id })
    const reason = refusal(live, { runtime, kind: 'start', from: 'host', to: pod })
    if (reason !== undefined) { live.trace.emit({ type: 'denied', id, reason }); return failure('denied', reason) }
    const t0 = performance.now()
    const made = await live.instance(pod)
    const r: NanoResult<void> = made.ok ? success(undefined) : made
    live.trace.emit({ type: 'delivered', id, result: r, ms: performance.now() - t0 })
    return r
  }

  /** `started`: whether this caller started it (else it was running, or another caller's start built it). */
  async function begin(pod: string): Promise<NanoResult<{ started: boolean }>> {
    const r = at()
    if (!r.ok) return r
    if (live.closed()) return failure('not-found', 'application is closed')
    if (!lookup(live.now()).placed.get(r.value)?.has(pod)) return failure('not-found', `${pod} is not placed in ${r.value}`)
    const key = `${r.value}|${pod}`, other = under.get(key)
    if (other) { const o = await other; return o.ok ? success({ started: false }) : o }
    if (status(pod) === 'running') return success({ started: false })
    const mine = send(r.value, pod)
    under.set(key, mine)
    try { const m = await mine; return m.ok ? success({ started: true }) : m } finally { if (under.get(key) === mine) under.delete(key) }
  }

  return {
    async start(pod: string): Promise<NanoResult<void>> {
      const r = await begin(pod)
      return !r.ok ? r : r.value.started ? success(undefined) : failure('invalid-input', `${pod} is already running`)
    },
    async getOrCreate(pod: string): Promise<NanoResult<{ started: boolean; pod: Client }>> {
      const r = await begin(pod)
      return r.ok ? success({ started: r.value.started, pod: call(pod) }) : r
    },
  }
}
