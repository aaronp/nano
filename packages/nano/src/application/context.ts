/**
 * The context a pod's factory gets, for pod `name`: it reads the deployment as it is at each call, over the call
 * subscriptions from `name` in every runtime the pod is placed in.
 *
 *   const ctx = contextFor(live, 'send')
 *   ctx.one(KV)                    // the one KV wired from send, in whichever runtime; a client sends in that runtime
 *   await ctx.publish(tick, 1)     // one message per event subscription from send with that source
 */
import type { NanoContext } from '../context.ts'
import type { Client, Interface } from '../iface.ts'
import { port } from '../iface.ts'
import { failure, success } from '../result.ts'
import { matches, selectorData, type SelectorData } from '../selector.ts'
import { client, send, type Live } from './messages.ts'

export function contextFor(live: Live, name: string): NanoContext {
  const placed = () => Object.entries(live.now().runtimes).filter(([, r]) => r.pods.includes(name))

  /** A client for every call subscription from `name` matching `s`: runtimes in order, then subscriptions in order. */
  const clients = (s: Interface | SelectorData) => {
    const want = selectorData(s), d = live.now()
    return placed().flatMap(([runtime, r]) => r.subscriptions.flatMap(sub => {
      if (sub.kind !== 'call' || sub.from !== name) return []
      const impl = live.registry.implementation(d.pods[sub.to]!.implementation)!
      const target = { name: sub.to, runtime, implementation: impl.coord, provider: impl.provider,
        provides: new Set(impl.provides.map(i => i.coord)), tags: new Set(d.tags?.[sub.to] ?? []) }
      if (!matches(want, target)) return []
      const gone = () => live.now().runtimes[runtime]?.subscriptions.some(x => x.kind === 'call' && x.from === name && x.to === sub.to)
        ? undefined : `${name}->${sub.to} is no longer in ${runtime}`
      return [client(live, runtime, name, sub.to, gone)]
    }))
  }

  return {
    self: name,
    get runtimes() { return placed().map(([id]) => id) },
    one<I extends Interface>(s: I | SelectorData) {
      const all = clients(s), what = JSON.stringify(selectorData(s))
      if (all.length === 0) return failure('not-found', `${name}: nothing wired matches ${what}`)
      if (all.length > 1) return failure('ambiguous', `${name}: ${all.length} wired match ${what}`)
      return success(all[0] as Client<I>)
    },
    all: <I extends Interface>(s: I | SelectorData) => clients(s) as Client<I>[],
    async publish(o, data) {
      const i = live.registry.implementation(live.now().pods[name]?.implementation ?? '')?.provides.find(i => i.byCoord.has(o.coord))
      if (!i || o.kind !== 'event') return live.trace.emit({ type: 'warning', reason: `${name}: ${o.name} is not one of its events` })
      const source = port(i, o)
      await Promise.all(placed().flatMap(([runtime, r]) => r.subscriptions.flatMap(sub =>
        sub.kind === 'event' && sub.from === name && sub.source === source ? [send(live, runtime, name, sub.to, sub.target, data)] : [])))
    },
  }
}
