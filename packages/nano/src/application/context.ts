/**
 * The context a pod's factory gets, for pod `name`: it reads the deployment as it is at each call, over the call
 * subscriptions from `name` in every runtime that lists one (placed there or not), each a `Selection`. `onClose` adds a listener to the
 * build this context belongs to; the `on` subscriptions this build made are dropped through it. With `invoked` it is a
 * handler invocation's: `callingOp` is its port, and its calls and publishes continue that message's chain
 * (`correlation`, `cause` = its id); `on` and listeners stay the build's.
 *
 *   const ctx = contextFor(live, 'send', fn => …)
 *   ctx.one(KV)                    // success(the one KV wired from send, in whichever runtime), or not-found / not-unique
 *   kv.call.put('k'); kv.on(KV.ops.put, fn)   // sent in that runtime; hear its put calls ({ input, output }) there until this build closes
 *   await ctx.publish(tick, 1)     // emitted: one message per pipe from send with that source, and to `on` subscribers
 */
import type { NanoContext, Selection } from '../context.ts'
import type { Client, Interface } from '../iface.ts'
import { port } from '../iface.ts'
import type { Op } from '../op.ts'
import { failure, success, type Fail, type NanoResult } from '../result.ts'
import { matches, selectorData, type Selector, type SelectorData } from '../selector.ts'
import { client, emit } from './emit.ts'
import { connect as connectOn } from './connection.ts'
import { iterate } from './iterate.ts'
import { thrown } from '../plain.ts'
import { impl, placedIn, type Live, type On } from './messages.ts'
import { lookup } from './lookup.ts'

/** The port of `o` on `pod`'s implementation, if it has `o`. */
const portOf = (live: Live, pod: string, o: Op) => {
  const i = impl(live, pod)?.provides.find(i => i.byCoord.has(o?.coord))
  return i && port(i, o)
}

/** `s` as selector data; undefined if it is no selector at all. */
const dataOf = (s: unknown) => (typeof s === 'object' && s ? selectorData(s as Selector) : undefined)

/** Whether `data` fits event `o`'s schema; unreadable data does not. */
const fitsData = (o: Op, data: unknown) => { try { return !o.output || o.output.check(data) } catch { return false } }

type Heard = { pod: string; fn: Parameters<NanoContext['addOnPodChangeListener']>[0] }
/** Each build's `on` subscriptions (`mine`, undefined once it has closed) and pod-change listeners, by its `onClose`. */
const builds = new WeakMap<object, { mine?: Set<On>; heard: Set<Heard> }>()

/** The build's state, made (and dropped at its close) the first time its `onClose` is seen. */
function buildOf(live: Live, onClose: NanoContext['addOnCloseListener']) {
  const known = builds.get(onClose)
  if (known) return known
  const b: { mine?: Set<On>; heard: Set<Heard> } = { mine: new Set(), heard: new Set() }
  builds.set(onClose, b)
  onClose(() => { for (const o of [...b.mine!]) o.end(); b.mine = undefined; for (const h of b.heard) live.listeners.podChanges.delete(h) })
  return b
}

export function contextFor(live: Live, name: string, onClose: NanoContext['addOnCloseListener'], invoked?: { id: string; correlation: string; port: string }): Omit<NanoContext, 'deps'> {
  const b = buildOf(live, onClose), chain = invoked && { correlation: invoked.correlation, cause: invoked.id }

  /** The call edge from `name` to `to` in `runtime`, read live: a call or delivery through it after `apply` removed it is not-found. */
  const selection = <I extends Interface>(runtime: string, to: string): Selection<I> => {
    const gone = () => lookup(live.now()).calls.has(`${runtime} ${name} ${to}`)
      ? undefined : failure('not-found', `${name}->${to} is no longer in ${runtime}`)
    return { pod: to, runtime, call: client(live, runtime, name, to, gone, chain) as Client<I>, on(o: Op, fn?: (e: never) => void | Promise<void>) {
      let stop: ((fail?: Fail) => void) | undefined
      const connect = (fn: On['fn']) => {
        const p = portOf(live, to, o)
        if (!p) throw thrown({ type: 'unknown-op', reason: `${name}: ${o?.name} is not an op of ${to}` })
        const why = !b.mine ? failure('not-found', `${name}: this build is closed`) : gone()
        if (why && !why.ok) throw thrown(why.fail)
        const c = connectOn(live, { runtime, from: to, port: p, to: name, gone, fn }, f => stop?.(f))
        if (!c.ok) throw thrown(c.fail)
        const sub = c.value
        b.mine!.add(sub)
        return () => { b.mine?.delete(sub); sub.end() }
      }
      return fn ? connect(fn as On['fn']) : iterate(connect, s => { stop = s })
    } } as Selection<I>
  }

  /** Every call subscription from `name` matching `s`: runtimes in order, then subscriptions in order. */
  const selections = <I extends Interface>(s: I | SelectorData): Selection<I>[] => {
    const want = dataOf(s), d = live.now()
    if (!want) return []
    return (lookup(d).callsFrom.get(name) ?? []).flatMap(({ runtime, to }) => {
      const sub = { to }
      const i = impl(live, sub.to)!
      const target = { name: sub.to, runtime, implementation: i.coord, provider: i.provider,
        provides: new Set(i.provides.map(i => i.coord)), tags: new Set(d.tags?.[sub.to] ?? []) }
      return matches(want, target) ? [selection<I>(runtime, sub.to)] : []
    })
  }

  const ctx: Omit<NanoContext, 'deps'> = {
    self: name,
    ...(invoked && { callingOp: invoked.port }),
    get runtimes() { return placedIn(live, name).map(([id]) => id) },
    one<I extends Interface>(s: I | SelectorData): NanoResult<Selection<I>> {
      const all = selections<I>(s), what = JSON.stringify(dataOf(s))
      if (all.length === 0) return failure('not-found', `${name}: nothing wired matches ${what}`)
      if (all.length > 1) return failure('not-unique', `${name}: ${all.length} wired match ${what}`)
      return success(all[0]!)
    },
    all: selections,
    async publish(o, data) {
      const p = portOf(live, name, o)
      if (!p || o.kind !== 'event') return live.trace.emit({ type: 'warning', reason: `${name}: ${o?.name} is not one of its events` })
      if (!fitsData(o, data)) return live.trace.emit({ type: 'failure', pod: name, reason: `${name}: ${o.name} data does not fit ${o.output?.label ?? 'its schema'}` })
      await emit(live, name, p, { output: data }, chain)
    },
    addOnPodChangeListener(fn) {
      if (!b.mine) return   // closed build
      const h = { pod: name, fn }; b.heard.add(h); live.listeners.podChanges.add(h)
    },
    addOnCloseListener: onClose,
  }
  return ctx
}
