/**
 * The runtime: a map of coords to pods (registering gives `<implementation>#<n>`), subscriptions between them as data
 * with live/waiting/broken status, policy on every message and rewire, books per subscription, and one stream. It
 * invokes a pod only through `send`, with a context it makes; a pod may be registered in several runtimes.
 *
 *   const rt = createRuntime('r1', { registry })
 *   const db = rt.register(Pod.create(memDb)).value                        // 'acme/db/mem#0'
 *   rt.subscribe({ kind: 'call', from: main, to: { implements: 'acme/db' } })   // the ends resolved once, saved as coords
 *   await rt.call(db).get('k')                                             // from 'host': policed, on the stream
 *   rt.listen(e => console.log(e))                                         // { type: 'pod-created', coord, implementation }, …
 */
import { Pod } from '../pod.ts'
import { Policies, type Policy } from '../policy.ts'
import type { Registry } from '../registry.ts'
import { failure, success, type NanoResult } from '../result.ts'
import type { EndSelector, Target } from '../selector.ts'
import { hostCall, send, type Book } from './calls.ts'
import { resolveEnd } from './connect.ts'
import { ID, podTable } from './pods.ts'
import { provision, type Unsatisfied } from './provision.ts'
import { subscriptionTable, type NewSubscription, type Status, type SubscriptionData } from './subscriptions.ts'
import { tracer, type RuntimeEvent } from './trace.ts'
import { connectionsOf, type Wiring } from './verbs.ts'

export { ID, MAX_PODS, MAX_RUNTIMES, MAX_SUBSCRIPTIONS, instanceCoord, parseInstance } from './pods.ts'
export { invalid, nextId, reordered, statusOf, type NewSubscription, type Status, type SubscriptionData } from './subscriptions.ts'
export type { Book } from './calls.ts'
export type { Unsatisfied } from './provision.ts'
export type { RuntimeEvent } from './trace.ts'

/** A subscription whose ends may be selectors, each resolved once to one registered pod's coord. */
export type NewConnection =
  | { id?: string; kind: 'call'; from: string | EndSelector; to: string | EndSelector }
  | { id?: string; kind: 'event'; from: string | EndSelector; source: string; to: string | EndSelector; target: string }

/** A host's calls into one pod, by op name. */
type HostCalls = Record<string, (input: unknown) => Promise<NanoResult<unknown>>>

export type Runtime = {
  readonly id: string
  readonly policy: Policy
  /** The pod's coord here: the next `<implementation>#<n>`, or `coord` (of its implementation, free; the counter moves past it). */
  register(pod: Pod, coord?: string): NanoResult<string>
  /** This runtime's subscriptions naming it go; the pod keeps running, in other runtimes too. */
  unregister(coord: string): NanoResult<void>
  pod(coord: string): Pod | undefined
  /** Coords, in register order. */
  pods(): readonly string[]
  /** The next index per implementation (coords are never reused), for saving. */
  next(): Readonly<Record<string, number>>
  /** `rt.call(coord).<op>(input)`: from 'host', policed and on the stream; an unknown coord is `not-found`. */
  call(coord: string): HostCalls
  subscribe(s: NewSubscription | NewConnection): NanoResult<SubscriptionData>
  unsubscribe(id: string): NanoResult<void>
  retarget(id: string, to: string): NanoResult<void>
  reorder(consumer: string, ids: string[]): NanoResult<void>
  subscriptions(): readonly SubscriptionData[]
  status(id: string): Status | undefined
  /** Messages delivered over a subscription and the last result; undefined for an unknown id. */
  books(id: string): Book | undefined
  /**
   * The one stream, in order: lifecycle (`pod-created`, `pod-state`, `pod-swapped`, `pod-removed`), wiring, messages
   * (`sent`, then `delivered` or `denied`), problems (`failure`, `warning`). A throwing listener is swallowed. Off it:
   * verb results `missing-component` and `ambiguous`, and a host call to an unknown coord (no message was sent).
   */
  listen(fn: (e: RuntimeEvent) => void): () => void
  /** Put a warning on this runtime's stream (the application's notes, as they happen). */
  warn(reason: string): void
  /** Settle the pod's unconnected dependencies, synchronously: what is left unsatisfied, and why. */
  provision(coord: string): NanoResult<Unsatisfied[]>
}

export type RuntimeOpts = {
  registry: Registry
  policy?: Policy
  tagsOf?: (coord: string) => ReadonlySet<string>
  /** Saved counters per implementation, so a coord is never reused after loading. */
  next?: Record<string, number>
  pod?: { timeoutMs?: number }
}

/** Throws on an id outside the id rule (a construction error, like a bad coord). */
export function createRuntime(id: string, opts: RuntimeOpts): Runtime {
  if (!ID.test(id)) throw new Error(`bad runtime id ${JSON.stringify(id)}`)
  const { registry } = opts
  const policy = opts.policy ?? Policies.allowAll()
  const trace = tracer()
  const target = (coord: string): Target | undefined => {
    const pod = pods.held.get(coord), impl = pod && registry.implementation(pod.implementation)
    return impl && {
      instance: coord, implementation: impl.coord, provider: impl.provider,
      provides: new Set(impl.provides.map(i => i.coord)), tags: opts.tagsOf?.(coord) ?? new Set(),
    }
  }
  const wiring: Wiring = {
    id, registry, trace, target,
    coordOf: pod => pods.coords.get(pod),
    subscriptions: () => subs.list(),
    status: sid => subs.statuses.get(sid),
    send: (sid, from, to, port, input) => send(through, sid, from, to, port, input),
  }
  const subs = subscriptionTable({
    id, policy, trace,
    end: c => { const pod = pods.held.get(c); return pod && { state: pod.state, impl: registry.implementation(pod.implementation)! } },
    gone: c => pods.gone(c),
  })
  const pods = podTable(wiring, impl => !!registry.implementation(impl), { ...opts.next }, {
    emit: trace.emit,
    changed: () => subs.recompute(),
    removed: c => { subs.cascade(c); subs.recompute() },
  })
  const through = { policy, books: subs.books, wiring, pod: (c: string) => pods.held.get(c) }
  const ends = { get coords() { return pods.held.keys() }, target }

  const rt: Runtime = {
    id, policy, register: pods.register, unregister: pods.unregister,
    pod: c => pods.held.get(c),
    pods: () => [...pods.held.keys()],
    next: () => ({ ...pods.next }),
    call: coord => hostCall(through, coord),
    subscribe(input) {
      const from = resolveEnd(ends, input.from)
      if (!from.ok) return from
      const to = resolveEnd(ends, input.to)
      if (!to.ok) return to
      return subs.subscribe({ ...input, from: from.value, to: to.value } as NewSubscription)
    },
    unsubscribe: subs.unsubscribe, retarget: subs.retarget, reorder: subs.reorder,
    subscriptions: () => [...subs.list()],
    status: sid => subs.statuses.get(sid),
    books: sid => (subs.list().some(s => s.id === sid) ? { ...(subs.books.get(sid) ?? { calls: 0 }) } : undefined),
    listen: trace.listen,
    warn: reason => trace.emit({ type: 'warning', reason }),
    provision(coord) {
      const pod = pods.held.get(coord)
      if (!pod) return failure('not-found', `${coord} is not registered in ${id}`)
      return success(provision({
        registry, target, coords: () => pods.held.keys(),
        connected: (c, d) => { const p = pods.held.get(c); return !!p && connectionsOf(p, d).length > 0 },
        make: impl => pods.register(Pod.create(impl, { ...opts.pod })),
        subscribe: rt.subscribe, status: rt.status,
      }, coord, registry.implementation(pod.implementation)!))
    },
  }
  return rt
}
