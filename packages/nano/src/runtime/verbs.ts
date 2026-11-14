/**
 * The context a runtime invokes a pod with. Its verbs search the pod's live call subscriptions in every runtime the pod
 * is registered in (a selector's `runtime` narrows to one); each call travels through the runtime holding that
 * subscription. `publish` delivers in every runtime the pod is in, each policing and recording its own deliveries.
 *
 *   const ctx = contextFor(wiring, 'acme/keys/signer#0', pod)   // what `send` passes to pod.invoke
 *   await ctx.one(Vault, v => v.ping('x'))                       // the one vault the signer is wired to, wherever
 */
import type { Call, CallSelector, Each, Found, NanoContext } from '../context.ts'
import { portKey, type Client, type Interface } from '../iface.ts'
import type { Pod } from '../pod.ts'
import type { Registry } from '../registry.ts'
import { failure, success, type Fail, type NanoResult } from '../result.ts'
import { matches, selectorData, type SelectorData, type Target } from '../selector.ts'
import { wirings } from './pods.ts'
import type { Status, SubscriptionData } from './subscriptions.ts'
import type { Tracer } from './trace.ts'

/** What verbs need of one runtime a pod is in, read live. */
export type Wiring = {
  readonly id: string
  readonly registry: Registry
  readonly trace: Tracer
  coordOf(pod: Pod): string | undefined
  subscriptions(): readonly SubscriptionData[]
  status(sid: string): Status | undefined
  target(coord: string): Target | undefined
  /** One message through this runtime: policed, recorded, booked; the callee invoked with this runtime's context. */
  send(sid: string, from: string, to: string, port: string, input: unknown): Promise<NanoResult<unknown>>
}

type Conn = { w: Wiring; sid: string; from: string; to: string; t: Target }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The pod's live call subscriptions matching `d` now, runtime by runtime (register order), each in saved order. */
export function connectionsOf(pod: Pod, d: SelectorData): Conn[] {
  return [...(wirings.get(pod) ?? [])].flatMap(([id, w]) => {
    const from = w.coordOf(pod)
    if (from === undefined || (d.runtime !== undefined && d.runtime !== id)) return []
    return w.subscriptions().flatMap(x => {
      if (x.kind !== 'call' || x.from !== from || w.status(x.id) !== 'live') return []
      const t = w.target(x.to)
      return t && matches(d, t) ? [{ w, sid: x.id, from, to: x.to, t }] : []
    })
  })
}

/** The context runtime `w` invokes `pod` (its coord there: `instance`) with. */
export function contextFor(w: Wiring, instance: string, pod: Pod): NanoContext {
  const impl = w.registry.implementation(pod.implementation)
  /** A client over one connection: the given interface's ops, or for plain data the target's matching interfaces. */
  const client = <I extends Interface>(s: CallSelector<I>, c: Conn): Client<I> => {
    const d = selectorData(s)
    const ifaces: readonly Interface[] = 'byCoord' in s ? [s] : (c.w.registry.implementation(c.t.implementation)?.provides ?? []).filter(i => d.implements === undefined || i.coord === d.implements)
    const out: Record<string, (input: unknown) => Promise<NanoResult<unknown>>> = {}
    for (const i of ifaces)
      for (const o of Object.values(i.ops))
        if (o.kind !== 'source' && !(o.name in out)) out[o.name] = input => c.w.send(c.sid, c.from, c.to, portKey(i.coord, o.coord), input)
    return out as Client<I> // built from the interface's own ops, so it has exactly Client<I>'s keys
  }
  const run = async <I extends Interface, T>(s: CallSelector<I>, fn: Call<I, T>, c: Conn): Promise<NanoResult<T>> => {
    try { return await fn(client(s, c)) } catch (e) { return failure('threw', `${c.to}: ${msg(e)}`) }
  }
  const conns = <I extends Interface>(s: CallSelector<I>) => connectionsOf(pod, selectorData(s))
  const missing = <I extends Interface>(s: CallSelector<I>) => {
    const d = selectorData(s)
    return failure('missing-component', `${instance}: no connection for ${JSON.stringify(d)}`, d.implements)
  }
  const ambiguous = <I extends Interface>(s: CallSelector<I>, cs: Conn[]) =>
    failure('ambiguous', `${instance}: ${JSON.stringify(selectorData(s))} matches ${cs.map(c => `${c.to} in ${c.w.id}`).join(', ')}`)
  const allFailed = (fs: { from: string; fail: Fail }[]) => failure('all-failed', fs.map(f => `${f.from}: ${f.fail.reason}`).join('; '))
  const found = <T>(r: NanoResult<T>, from: string): NanoResult<Found<T>> => (r.ok ? success({ value: r.value, from }) : r)
  const listDependencies = () =>
    Object.entries(impl?.dependencies ?? {}).map(([role, selector]) => {
      const targets = connectionsOf(pod, selector).map(c => c.to)
      return { role, selector, satisfied: targets.length > 0, targets }
    })

  return {
    instance,
    runtime: w.id,
    get runtimes() { return pod.runtimes },
    async one(s, fn) {
      const cs = conns(s)
      return cs.length === 0 ? missing(s) : cs.length > 1 ? ambiguous(s, cs) : run(s, fn, cs[0]!)
    },
    async optional(s, fn) {
      const cs = conns(s)
      return cs.length === 0 ? success({ none: true as const }) : cs.length > 1 ? ambiguous(s, cs) : found(await run(s, fn, cs[0]!), cs[0]!.to)
    },
    async any(s, fn) {
      const cs = conns(s)
      if (cs.length === 0) return missing(s)
      const tries = cs.map(async c => {
        const r = await run(s, fn, c)
        if (r.ok) return success({ value: r.value, from: c.to })
        throw { from: c.to, fail: r.fail } // Promise.any wants a rejection; caught just below
      })
      return Promise.any(tries).catch((e: AggregateError) => allFailed(e.errors))
    },
    async all(s, fn) {
      return Promise.all(conns(s).map(async c => ({ from: c.to, result: await run(s, fn, c) })))
    },
    async first(s, fn) {
      const c = conns(s)[0]
      return c ? run(s, fn, c) : missing(s)
    },
    async fallback(s, fn) {
      const cs = conns(s)
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
      for (const c of conns(s)) out.push({ from: c.to, result: await run(s, fn, c) })
      return out
    },
    async publish(op, data) {
      const drop = (why: string) => w.trace.emit({ type: 'failure', coord: instance, reason: `${instance}: ${why}` })
      const ports = (impl?.provides ?? []).flatMap(i => Object.values(i.ops).filter(o => o.kind === 'source' && o.coord === op.coord).map(o => portKey(i.coord, o.coord)))
      if (ports.length === 0) return drop(`${op.name} is not a source of this instance`)
      if (op.output && !op.output.check(data)) return drop(`${op.name} data does not fit its schema`)
      // Every runtime the pod is in now: one it has left, it publishes nowhere.
      await Promise.all([...(wirings.get(pod)?.values() ?? [])].flatMap(x => {
        const from = x.coordOf(pod)
        return x.subscriptions().filter(s => s.kind === 'event' && s.from === from && ports.includes(s.source) && x.status(s.id) === 'live')
          .map(s => s.kind === 'event' && x.send(s.id, s.from, s.to, s.target, data))
      }))
    },
    listDependencies,
    hasDependencies(role) {
      const ds = listDependencies()
      return role === undefined ? ds.every(d => d.satisfied) : ds.some(d => d.role === role && d.satisfied)
    },
  }
}
