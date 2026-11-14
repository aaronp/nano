/**
 * Pods in a runtime: coords `<implementation>#<n>` (`n` per implementation, from 0, never reused), register order, and
 * the map from each pod to the wiring of every runtime it is registered in (what its handlers' verbs search).
 *
 *   instanceCoord('acme/keys/vault', 0)        // 'acme/keys/vault#0'
 *   parseInstance('acme/keys/vault#0')         // { implementation: 'acme/keys/vault', index: 0 }
 *   const table = podTable(wiring, { next }, { emit, changed, removed })
 *   table.register(pod)                        // success('acme/keys/vault#0'); pod-created, then its pod-state
 */
import { COORD } from '../iface.ts'
import type { Pod, PodState } from '../pod.ts'
import { failure, success, type NanoResult } from '../result.ts'
import type { RuntimeEvent } from './trace.ts'
import type { Wiring } from './verbs.ts'

/** Runtime and subscription ids: the one rule the runtime, the application and the document share. */
export const ID = /^[^/\s#\x00-\x1f\x7f]{1,64}$/
/** Pods one runtime holds, at most. */
export const MAX_PODS = 500
/** Subscriptions in one runtime, at most. */
export const MAX_SUBSCRIPTIONS = 2000
/** Runtimes in a document, at most; the application's root takes one when saved, so it makes or defines one fewer. */
export const MAX_RUNTIMES = 50
/** The highest index a coord can carry. */
const MAX_INDEX = 999_999_999

export const instanceCoord = (implementation: string, n: number): string => `${implementation}#${n}`

export function parseInstance(coord: string): { implementation: string; index: number } | undefined {
  const m = /^(.*)#(0|[1-9][0-9]{0,8})$/.exec(coord)
  return m && COORD.test(m[1]!) ? { implementation: m[1]!, index: Number(m[2]) } : undefined
}

/** Each pod's runtimes, by id, in register order: what its handlers' verbs search. */
export const wirings = new WeakMap<Pod, Map<string, Wiring>>()

/** What the pod table tells the rest of its runtime: a state change (statuses follow it), and a coord gone (its subscriptions go). */
type Hooks = { emit(e: RuntimeEvent): void; changed(): void; removed(coord: string): void }

/** One runtime's pods by coord, and its counters. `w` is this runtime's wiring, put in each registered pod's `wirings`. */
export function podTable(w: Wiring, known: (implementation: string) => boolean, next: Record<string, number>, on: Hooks) {
  const held = new Map<string, Pod>() // insertion order is register order; saving relies on it
  const coords = new Map<Pod, string>()
  const leaves = new Map<string, () => void>()

  function register(pod: Pod, coord?: string): NanoResult<string> {
    const impl = pod.implementation, here = coords.get(pod)
    if (here !== undefined) return failure('exists', `${impl}: already here as ${here}`)
    if (!known(impl)) return failure('not-found', `no implementation ${impl} in ${w.id}'s registry`)
    if (held.size >= MAX_PODS) return failure('invalid-input', `${w.id} would hold more than ${MAX_PODS} pods`)
    const p = coord === undefined ? { implementation: impl, index: next[impl] ?? 0 } : parseInstance(coord)
    if (!p || p.implementation !== impl) return failure('invalid-input', `${coord} is not a coord of ${impl}`)
    if (p.index > MAX_INDEX) return failure('invalid-input', `${impl}: no index is left (the last is ${MAX_INDEX})`)
    const c = instanceCoord(impl, p.index)
    if (held.has(c)) return failure('exists', `${c} is taken`)
    next[impl] = Math.max(next[impl] ?? 0, p.index + 1)
    held.set(c, pod)
    coords.set(pod, c)
    wirings.set(pod, (wirings.get(pod) ?? new Map()).set(w.id, w))
    let was = pod.state
    leaves.set(c, pod.join(w.id, (state, reason) => {
      // The pod tells states only: running again, other than out of starting, is a swap. ponytail: a swap that
      // lands while the first make is still starting shows as pod-state running alone; a join-level swap signal if that matters.
      if (state === 'running' && was !== 'starting') on.emit({ type: 'pod-swapped', coord: c })
      if (state !== was || state === 'failed') on.emit({ type: 'pod-state', coord: c, state, ...(reason !== undefined && { reason }) })
      was = state
      on.changed()
    }))
    on.emit({ type: 'pod-created', coord: c, implementation: impl })
    on.emit({ type: 'pod-state', coord: c, state: pod.state })
    on.changed()
    return success(c)
  }

  /** The pod leaves this runtime only: this runtime's subscriptions naming it go, then pod-removed; it keeps running elsewhere. */
  function unregister(coord: string): NanoResult<void> {
    const pod = held.get(coord)
    if (!pod) return failure('not-found', `${coord} is not registered in ${w.id}`)
    held.delete(coord)
    coords.delete(pod)
    wirings.get(pod)?.delete(w.id)
    leaves.get(coord)?.()
    leaves.delete(coord)
    on.removed(coord)
    on.emit({ type: 'pod-removed', coord })
    return success(undefined)
  }

  /** Below its implementation's counter yet not held: it was unregistered, and a coord is never reused. */
  const gone = (coord: string) => {
    const p = parseInstance(coord)
    return !!p && p.index < (next[p.implementation] ?? 0) && !held.has(coord)
  }
  return { register, unregister, held, coords, gone, next }
}
