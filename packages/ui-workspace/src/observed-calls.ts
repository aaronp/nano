/**
 * Op-level calls: the pairs a deployment declares (an edge's `ops`, else its pod's implementation `calls`) and the
 * pairs the app's stream shows (a call's `cause` names the sending op). Pure over the data, plus one listener.
 *
 *   declaredOps(d, registry)                  // [{ from:'front', to:'store', source:'acme.Front/send', target:'acme.Store/save', declared:true, seen:false, … }]
 *   const o = observeCalls(app, registry)     // o.calls(), o.reconciled(), o.listen(fn), o.stop()
 *
 * A call made outside any invocation (timer, source, the host) has `source: null`. Host calls and denied calls are
 * listed, never reconciled into the deployment.
 */
import type { AppDeployment, AppEvent, Application, Registry } from '@pritzlaff/nano-core'

export type OpCall = { runtime: string; from: string; to: string; source: string | null; target: string; declared: boolean; seen: boolean }
type Sent = Extract<AppEvent, { type: 'sent' }>
const key = (c: Omit<OpCall, 'declared' | 'seen'>) => [c.runtime, c.from, c.to, c.source, c.target].join('\n')

export function declaredOps(d: AppDeployment, registry: Registry): OpCall[] {
  const out: OpCall[] = []
  for (const [runtime, rt] of Object.entries(d.runtimes)) for (const e of rt.subscriptions) {
    if (e.kind !== 'call') continue
    const add = (source: string, target: string) => out.push({ runtime, from: e.from, to: e.to, source, target, declared: true, seen: false })
    if (e.ops) { for (const o of e.ops) add(o.source, o.target); continue }
    const impl = registry.implementation(d.pods[e.from]?.implementation ?? ''), to = registry.implementation(d.pods[e.to]?.implementation ?? '')
    if (!impl || !to) continue
    for (const [op, targets] of Object.entries(impl.calls)) {
      const from = impl.provides.find(i => Object.values(i.ops).some(o => o.name === op))
      for (const t of targets) {
        const [role, name] = t.split('.'), iface = impl.dependencies[role!]?.implements
        if (from && iface && to.provides.some(i => i.coord === iface)) add(`${from.coord}/${op}`, `${iface}/${name}`)
      }
    }
  }
  return out
}

export function observeCalls(app: Application, registry: Registry) {
  const sent = new Map<string, Sent>(), seen = new Map<string, { call: OpCall; ok: number; id: Set<string> }>(), fns = new Set<() => void>()
  const off = app.listen(e => {
    if (e.type === 'sent') {
      sent.set(e.id, e)
      // ponytail: keeps the last 1000 messages as possible causes; a cause older than that reads as `source: null`.
      if (sent.size > 1000) sent.delete(sent.keys().next().value!)
      if (e.kind !== 'call') return
      const cause = e.cause === undefined ? undefined : sent.get(e.cause)
      const call = { runtime: e.runtime, from: e.from, to: e.to, source: cause?.to === e.from ? cause.port : null, target: e.port, declared: false, seen: true }
      const s = seen.get(key(call)) ?? { call, ok: 0, id: new Set() }
      s.ok++; s.id.add(e.id); seen.set(key(call), s)
    } else if (e.type === 'denied') {
      const s = [...seen.values()].find(x => x.id.delete(e.id))
      if (s) s.ok--
    } else if (e.type === 'delivered') { for (const s of seen.values()) s.id.delete(e.id) }
    else return
    for (const fn of [...fns]) fn()
  })
  const calls = (): OpCall[] => {
    const out = declaredOps(app.deployment(), registry), have = new Map(out.map(c => [key(c), c]))
    for (const [k, s] of seen) {
      const d = have.get(k)
      if (d) d.seen ||= s.ok > 0
      else out.push({ ...s.call })
    }
    return out
  }
  const reconciled = (): AppDeployment => {
    const d = structuredClone(app.deployment())
    const keep = declaredOps(d, registry).concat([...seen.values()].filter(s => s.ok > 0 && s.call.source !== null && s.call.from !== 'host').map(s => s.call))
    for (const [runtime, rt] of Object.entries(d.runtimes)) for (const e of rt.subscriptions) {
      if (e.kind !== 'call') continue
      const ops = new Map(keep.filter(c => c.runtime === runtime && c.from === e.from && c.to === e.to).map(c => [key(c), { source: c.source!, target: c.target }]))
      if (ops.size) e.ops = [...ops.values()]
    }
    return d
  }
  return { calls, reconciled, listen(fn: () => void) { fns.add(fn); return () => { fns.delete(fn) } }, stop: off }
}
