/**
 * The context a pod's factory gets, for pod `name`: it reads the deployment as it is at each call, over the call
 * subscriptions from `name` in every runtime the pod is placed in, each a `Selection`. `onClose` adds a listener to the
 * build this context belongs to; the `on` subscriptions this build made are dropped through it.
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
import { sourceFailed } from '../implementation.ts'
import { failure, success, type Fail, type NanoResult } from '../result.ts'
import { matches, selectorData, type Selector, type SelectorData } from '../selector.ts'
import { client, emit } from './emit.ts'
import { connect as connectOn } from './connection.ts'
import { iterate } from './iterate.ts'
import { impl, placedIn, type Live, type On } from './messages.ts'

/** The port of `o` on `pod`'s implementation, if it has `o`. */
const portOf = (live: Live, pod: string, o: Op) => {
  const i = impl(live, pod)?.provides.find(i => i.byCoord.has(o?.coord))
  return i && port(i, o)
}

/** `s` as selector data; undefined if it is no selector at all. */
const dataOf = (s: unknown) => (typeof s === 'object' && s ? selectorData(s as Selector) : undefined)

/** Whether `data` fits event `o`'s schema; unreadable data does not. */
const fitsData = (o: Op, data: unknown) => { try { return !o.output || o.output.check(data) } catch { return false } }

export function contextFor(live: Live, name: string, onClose: NanoContext['addOnCloseListener']): Omit<NanoContext, 'deps'> {
  /** This build's `on` subscriptions; undefined once it has closed. */
  let mine: Set<On> | undefined = new Set()
  const heard = new Set<{ pod: string; fn: Parameters<NanoContext['addOnPodChangeListener']>[0] }>()
  onClose(() => { for (const o of [...mine!]) o.end(); mine = undefined; for (const h of heard) live.listeners.podChanges.delete(h) })

  /** The call edge from `name` to `to` in `runtime`, read live: a call or delivery through it after `apply` removed it is not-found. */
  const selection = <I extends Interface>(runtime: string, to: string): Selection<I> => {
    const gone = () => live.now().runtimes[runtime]?.subscriptions.some(x => x.kind === 'call' && x.from === name && x.to === to)
      ? undefined : failure('not-found', `${name}->${to} is no longer in ${runtime}`)
    return { pod: to, runtime, call: client(live, runtime, name, to, gone) as Client<I>, on(o: Op, fn?: (e: never) => void | Promise<void>) {
      let stop: ((fail?: Fail) => void) | undefined
      const connect = (fn: On['fn']) => {
        const p = portOf(live, to, o)
        if (!p || !mine || gone()) { if (!p) live.trace.emit({ type: 'warning', reason: `${name}: ${o?.name} is not an op of ${to}` }); stop?.(); return () => {} }
        const c = connectOn(live, { runtime, from: to, port: p, to: name, gone, fn }, f => stop?.(f))
        if (!c.ok) { stop?.(c.fail); return () => {} }
        const sub = c.value
        mine.add(sub)
        return () => { mine?.delete(sub); sub.end() }
      }
      return fn ? connect(fn as On['fn']) : iterate(connect, s => { stop = s })
    } } as Selection<I>
  }

  /** Every call subscription from `name` matching `s`: runtimes in order, then subscriptions in order. */
  const selections = <I extends Interface>(s: I | SelectorData): Selection<I>[] => {
    const want = dataOf(s), d = live.now()
    if (!want) return []
    return placedIn(live, name).flatMap(([runtime, r]) => r.subscriptions.flatMap(sub => {
      if (sub.kind !== 'call' || sub.from !== name) return []
      const i = impl(live, sub.to)!
      const target = { name: sub.to, runtime, implementation: i.coord, provider: i.provider,
        provides: new Set(i.provides.map(i => i.coord)), tags: new Set(d.tags?.[sub.to] ?? []) }
      return matches(want, target) ? [selection<I>(runtime, sub.to)] : []
    }))
  }

  const ctx: Omit<NanoContext, 'deps'> = {
    self: name,
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
      await emit(live, name, p, { output: data })
    },
    addOnPodChangeListener(fn) {
      if (!mine) return   // closed build
      const h = { pod: name, fn }; heard.add(h); live.listeners.podChanges.add(h)
    },
    addOnCloseListener: onClose,
  }
  sourceFailed.set(ctx, reason => live.trace.emit({ type: 'failure', pod: name, reason }))
  return ctx
}
