/**
 * The context a pod's factory gets, for pod `name`: it reads the deployment as it is at each call, over the call
 * subscriptions from `name` in every runtime the pod is placed in, each a `Selection`. `onClose` adds a listener to the
 * build this context belongs to; the `on` subscriptions this build made are dropped through it.
 *
 *   const ctx = contextFor(live, 'send', fn => …)
 *   ctx.one(KV).call.put('k')      // the one KV wired from send, in whichever runtime; sent in that runtime
 *   ctx.one(KV).on(KV.ops.put, fn) // hear its put results, in that runtime, until this build closes
 *   await ctx.publish(tick, 1)     // emitted: one message per pipe from send with that source, and to `on` subscribers
 */
import type { NanoContext, Selection } from '../context.ts'
import type { Client, Interface } from '../iface.ts'
import { port } from '../iface.ts'
import type { Op } from '../op.ts'
import { failure, type Fail, type NanoResult } from '../result.ts'
import { matches, selectorData, type SelectorData } from '../selector.ts'
import { client, emit } from './emit.ts'
import type { Live, On } from './messages.ts'

/** The port of `o` on `pod`'s implementation, if it has `o`. */
const portOf = (live: Live, pod: string, o: Op) => {
  const i = live.registry.implementation(live.now().pods[pod]?.implementation ?? '')?.provides.find(i => i.byCoord.has(o.coord))
  return i && port(i, o)
}

/** Whether `data` fits event `o`'s schema; unreadable data does not. */
const fitsData = (o: Op, data: unknown) => { try { return !o.output || o.output.check(data) } catch { return false } }

export function contextFor(live: Live, name: string, onClose: NanoContext['addOnCloseListener']): NanoContext {
  const placed = () => Object.entries(live.now().runtimes).filter(([, r]) => r.pods.includes(name))
  /** This build's `on` subscriptions; undefined once it has closed. */
  let mine: Set<On> | undefined = new Set()
  onClose(() => { for (const o of mine!) live.ons.delete(o); mine = undefined })

  const failed = <I extends Interface>(r: NanoResult<never>): Selection<I> =>
    ({ ok: false, fail: (r as { fail: Fail }).fail, call: client(live, '', name, '', () => r) as Client<I>, on: () => () => {} })

  /** The call edge from `name` to `to` in `runtime`, read live: a call or delivery through it after `apply` removed it is not-found. */
  const selection = <I extends Interface>(runtime: string, to: string): Selection<I> => {
    const gone = () => live.now().runtimes[runtime]?.subscriptions.some(x => x.kind === 'call' && x.from === name && x.to === to)
      ? undefined : failure('not-found', `${name}->${to} is no longer in ${runtime}`)
    return { ok: true, pod: to, runtime, call: client(live, runtime, name, to, gone) as Client<I>, on(o, fn) {
      const p = portOf(live, to, o)
      if (!p || !mine || gone()) { if (!p) live.trace.emit({ type: 'warning', reason: `${name}: ${o.name} is not an op of ${to}` }); return () => {} }
      const sub: On = { runtime, from: to, port: p, to: name, gone, fn }
      live.ons.add(sub); mine.add(sub)
      return () => { live.ons.delete(sub); mine?.delete(sub) }
    } }
  }

  /** Every call subscription from `name` matching `s`: runtimes in order, then subscriptions in order. */
  const selections = <I extends Interface>(s: I | SelectorData): Selection<I>[] => {
    const want = selectorData(s), d = live.now()
    return placed().flatMap(([runtime, r]) => r.subscriptions.flatMap(sub => {
      if (sub.kind !== 'call' || sub.from !== name) return []
      const impl = live.registry.implementation(d.pods[sub.to]!.implementation)!
      const target = { name: sub.to, runtime, implementation: impl.coord, provider: impl.provider,
        provides: new Set(impl.provides.map(i => i.coord)), tags: new Set(d.tags?.[sub.to] ?? []) }
      return matches(want, target) ? [selection<I>(runtime, sub.to)] : []
    }))
  }

  return {
    self: name,
    get runtimes() { return placed().map(([id]) => id) },
    one<I extends Interface>(s: I | SelectorData) {
      const all = selections<I>(s), what = JSON.stringify(selectorData(s))
      if (all.length === 0) return failed<I>(failure('not-found', `${name}: nothing wired matches ${what}`))
      if (all.length > 1) return failed<I>(failure('ambiguous', `${name}: ${all.length} wired match ${what}`))
      return all[0]!
    },
    all: selections,
    async publish(o, data) {
      const p = portOf(live, name, o)
      if (!p || o.kind !== 'event') return live.trace.emit({ type: 'warning', reason: `${name}: ${o.name} is not one of its events` })
      if (!fitsData(o, data)) return live.trace.emit({ type: 'failure', pod: name, reason: `${name}: ${o.name} data does not fit ${o.output?.type}` })
      await emit(live, name, p, data)
    },
    addOnCloseListener: onClose,
  }
}
