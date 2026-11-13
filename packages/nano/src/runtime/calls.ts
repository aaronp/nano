/**
 * Calls: a context's verbs routed over its home runtime's live call subscriptions, policy per message, books, and publish delivered in every runtime the instance's pod is a member of.
 * Every message is on the runtime's stream: `sent`, then `delivered` (result, ms) or `denied` (reason).
 * Calls into or out of an instance in an unfinished provisioning pass wait for the pass; calls during its own `make` fail at once.
 *
 *   const { ctx, bind } = contextFor(wiring, 'main#0', impl, config)   // bind(host) once the instance is made
 *   await ctx.one(DB, db => db.save(r))     // policed, invoked on the target instance, counted on the subscription's books
 *   const deliver = deliverer(wiring)       // a runtime's delivery of publishes, held in each pod record's holders
 */
import type { Call, CallSelector, Each, Found, NanoContext } from '../context.ts'
import { portKey, type Client, type Interface } from '../iface.ts'
import type { Implementation } from '../implementation.ts'
import type { Pod } from '../pod.ts'
import type { Policy } from '../policy.ts'
import { failure, success, type Fail, type NanoResult } from '../result.ts'
import { matches, selectorData, type SelectorData, type Target } from '../selector.ts'
import type { Instance, PodRecord } from './pods.ts'
import type { Status, SubscriptionData } from './subscriptions.ts'
import type { Tracer } from './trace.ts'

export type Book = { calls: number; last?: NanoResult<unknown> }

/** What calls need of one runtime, read live: pods, instance states and subscriptions change between calls. */
export type Wiring = {
  readonly id: string
  readonly policy: Policy
  readonly books: Map<string, Book>
  subscriptions(): readonly SubscriptionData[]
  status(id: string): Status | undefined
  locate(coord: string): { pod: PodRecord; instance: Instance } | undefined
  target(coord: string): Target | undefined
  readonly trace: Tracer
  /** While `coord` is in an unfinished provisioning pass, the pass's end; calls into or out of it wait for it. */
  settled?(coord: string): Promise<void> | undefined
}

/** Wait for any unfinished provisioning pass these instances are in; no await at all when there is none. */
async function ready(w: Wiring, ...coords: string[]): Promise<void> {
  for (const c of coords) { const p = w.settled?.(c); if (p) await p }
}

/** One runtime's delivery of a publish by `from` on source port `port`. */
export type Deliver = (from: string, port: string, data: unknown) => Promise<void>

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * One message over subscription `sid`: traced (`sent` once its subscription is found, then `denied` or `delivered`),
 * policed, invoked, booked. A denied message is not delivered and not counted.
 */
async function send(w: Wiring, sid: string, from: string, to: string, port: string, input: unknown): Promise<NanoResult<unknown>> {
  if (w.settled?.(from) || w.settled?.(to)) await ready(w, from, to)
  const sub = w.subscriptions().find(s => s.id === sid)
  if (!sub) return failure('not-found', `no subscription ${sid} in ${w.id}`) // gone while it waited for a pass
  const id = w.trace.message()
  w.trace.emit({ type: 'sent', id, subscription: sid, from, to, port, kind: sub.kind })
  const deny = (reason: string) => { w.trace.emit({ type: 'denied', id, reason }); return failure('denied', reason) }
  let v
  try { v = w.policy.isAllowed(from, to, input) } catch (e) {
    w.trace.emit({ type: 'failure', coord: from, reason: `policy threw: ${msg(e)}` })
    return deny(`policy threw: ${msg(e)}`)
  }
  if (!v.approved) return deny(v.reason)
  const host = w.locate(to)?.instance.host
  const t0 = performance.now()
  const r = host ? await host.invoke(port, input) : failure('not-found', `${to} is not a running instance in ${w.id}`)
  w.trace.emit({ type: 'delivered', id, result: r, ms: performance.now() - t0 })
  // Book only on the very subscription the call went over: unsubscribed, retargeted or replaced meanwhile, it is off the books.
  if (host && w.subscriptions().includes(sub)) w.books.set(sid, { calls: (w.books.get(sid)?.calls ?? 0) + 1, last: r })
  return r
}

/** Delivery of publishes in one runtime: every live event subscription from that instance on that port. */
export const deliverer = (w: Wiring): Deliver => async (from, port, data) => {
  const live = w.subscriptions().filter(s => s.kind === 'event' && s.from === from && s.source === port && w.status(s.id) === 'live')
  await Promise.all(live.map(s => s.kind === 'event' && send(w, s.id, from, s.to, s.target, data)))
}

type Conn = { sid: string; to: string }

/** The live call subscriptions from `instance`, in saved order, whose target matches `d` now: what satisfies a dependency. */
export function connectionsOf(w: Wiring, instance: string, d: SelectorData): Conn[] {
  return w.subscriptions().flatMap(x => {
    if (x.kind !== 'call' || x.from !== instance || w.status(x.id) !== 'live') return []
    const t = w.target(x.to)
    return t && matches(d, t) ? [{ sid: x.id, to: x.to }] : []
  })
}

/** An instance's context, and `bind` to give it its host once made: publish goes only through that host. */
export function contextFor(w: Wiring, instance: string, impl: Implementation, config: unknown): { ctx: NanoContext; bind(pod: Pod): void } {
  let own: Pod | undefined
  const connections = <I extends Interface>(s: CallSelector<I>) => connectionsOf(w, instance, selectorData(s))
  /** A verb made during this instance's provisioning pass waits for the pass to wire it; otherwise it reads connections at once. */
  const busy = () => w.settled?.(instance)
  /** `make` is construction, not use: until the host is bound, calls fail at once (waiting on its own pass would never end). */
  const making = () => (own ? undefined : failure('missing-component', `${instance}: dependencies are not available while it is being made`))
  /** A client over one connection: the given interface's ops, or for plain data the target's matching interfaces. */
  const client = <I extends Interface>(s: CallSelector<I>, c: Conn): Client<I> => {
    const d = selectorData(s)
    const ifaces: readonly Interface[] = 'byCoord' in s ? [s] : (w.locate(c.to)?.pod.implementation.provides ?? []).filter(i => d.implements === undefined || i.coord === d.implements)
    const out: Record<string, (input: unknown) => Promise<NanoResult<unknown>>> = {}
    for (const i of ifaces)
      for (const o of Object.values(i.ops))
        if (o.kind !== 'source' && !(o.name in out)) out[o.name] = input => send(w, c.sid, instance, c.to, portKey(i.coord, o.coord), input)
    return out as Client<I> // built from the interface's own ops, so it has exactly Client<I>'s keys
  }
  const run = async <I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>, c: Conn): Promise<NanoResult<T>> => {
    try { return await fn(client(s, c)) } catch (e) { return failure('threw', `${c.to}: ${msg(e)}`) }
  }
  const missing = <I extends Interface>(s: CallSelector<I>) => {
    const d = selectorData(s)
    return failure('missing-component', `${instance}: no connection for ${JSON.stringify(d)}`, d.implements)
  }
  const ambiguous = <I extends Interface>(s: CallSelector<I>, cs: Conn[]) => failure('ambiguous', `${instance}: ${JSON.stringify(selectorData(s))} matches ${cs.map(c => c.to).join(', ')}`)
  const allFailed = (fs: { from: string; fail: Fail }[]) => failure('all-failed', fs.map(f => `${f.from}: ${f.fail.reason}`).join('; '))
  const found = <T>(r: NanoResult<T>, from: string): NanoResult<Found<T>> => (r.ok ? success({ value: r.value, from }) : r)
  const listDependencies = () =>
    Object.entries(impl.dependencies).map(([role, selector]) => {
      const targets = connectionsOf(w, instance, selector).map(c => c.to)
      return { role, selector, satisfied: targets.length > 0, targets }
    })

  const ctx = {
    instance,
    runtime: w.id,
    config,
    async one<I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>) {
      const m = making()
      if (m) return m
      if (busy()) await ready(w, instance)
      const cs = connections(s)
      return cs.length === 0 ? missing(s) : cs.length > 1 ? ambiguous(s, cs) : run(s, fn, cs[0]!)
    },
    async optional<I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>) {
      const m = making()
      if (m) return m
      if (busy()) await ready(w, instance)
      const cs = connections(s)
      return cs.length === 0 ? success({ none: true }) : cs.length > 1 ? ambiguous(s, cs) : found(await run(s, fn, cs[0]!), cs[0]!.to)
    },
    async any<I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>) {
      const m = making()
      if (m) return m
      if (busy()) await ready(w, instance)
      const cs = connections(s)
      if (cs.length === 0) return missing(s)
      const tries = cs.map(async c => {
        const r = await run(s, fn, c)
        if (r.ok) return success({ value: r.value, from: c.to })
        throw { from: c.to, fail: r.fail } // Promise.any wants a rejection; caught just below
      })
      return Promise.any(tries).catch((e: AggregateError) => allFailed(e.errors))
    },
    async all<I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>) {
      if (making()) return []
      if (busy()) await ready(w, instance)
      return Promise.all(connections(s).map(async c => ({ from: c.to, result: await run(s, fn, c) })))
    },
    async first<I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>) {
      const m = making()
      if (m) return m
      if (busy()) await ready(w, instance)
      const c = connections(s)[0]
      return c ? run(s, fn, c) : missing(s)
    },
    async fallback<I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>) {
      const m = making()
      if (m) return m
      if (busy()) await ready(w, instance)
      const cs = connections(s)
      if (cs.length === 0) return missing(s)
      const failures: { from: string; fail: Fail }[] = []
      for (const c of cs) {
        const r = await run(s, fn, c)
        if (r.ok) return success({ value: r.value, from: c.to, failures })
        failures.push({ from: c.to, fail: r.fail })
      }
      return allFailed(failures)
    },
    async each<I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>) {
      const out: Each<T> = []
      if (making()) return []
      if (busy()) await ready(w, instance)
      for (const c of connections(s)) out.push({ from: c.to, result: await run(s, fn, c) })
      return out
    },
    async publish(op, data) {
      const drop = (why: string) => w.trace.emit({ type: 'failure', coord: instance, reason: `${instance}: ${why}` })
      const ports = impl.provides.flatMap(i => Object.values(i.ops).filter(o => o.kind === 'source' && o.coord === op.coord).map(o => portKey(i.coord, o.coord)))
      if (ports.length === 0) return drop(`${op.name} is not a source of this instance`)
      if (op.output && !op.output.check(data)) return drop(`${op.name} data does not fit its schema`)
      if (!own) return drop('dependencies are not available while it is being made')
      if (busy()) await ready(w, instance)
      // Only the host this context was made for, while it is still the instance's: a removed or replaced instance publishes nowhere.
      const at = w.locate(instance)
      const runtimes = at?.instance.host === own ? [...at.pod.holders] : []
      await Promise.all(ports.flatMap(p => runtimes.map(h => h.deliver(instance, p, data))))
    },
    listDependencies,
    hasDependencies(role) {
      const ds = listDependencies()
      return role === undefined ? ds.every(d => d.satisfied) : ds.some(d => d.role === role && d.satisfied)
    },
  } satisfies NanoContext
  return { ctx, bind: pod => { own = pod } }
}
