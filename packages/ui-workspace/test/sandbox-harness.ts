// Shared harness of the sandbox tests: pods s (sandboxed) and h (host), a registry, and a MessageChannel frame served in-process.
import { Type } from 'typebox'
import { Coord, Application, Pod, AppDeployment, Registry, Schema, Interface, Implementation, Op, provide, success, type AppEvent, type NanoContext, type NanoResult } from '@pritzlaff/nano-core'
import { edgesFor } from '../src/sandbox/edges.ts'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { serve } from '../src/sandbox/serve.ts'
import { standIn, type Frame } from '../src/sandbox/stand-in.ts'

export const ns = Coord.namespace('acme')

export const Text = Schema.define(Type.String(), 'Text')
export const Num = Schema.define(Type.Number(), 'Num')
export const Nothing = Schema.define(Type.Null(), 'Nothing')
export const Echo = Interface.define('t.Echo', { echo: Op.action(Text, Text) })
export const Ticks = Interface.define('t.Ticks', { tick: Op.event(Num) })
export const H = Interface.define('t.H', { record: Op.action(Num, Nothing), said: Op.event(Num) })

export const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

export const st: { inFrame?: NanoContext; inH?: NanoContext; view?: Omit<ViewTarget, 'registry'>; frameClosed: number } = { frameClosed: 0 }
export const seen: number[] = []
export const sImpl = Implementation.define(ns.implementationId('s'), { provides: [Echo, Ticks], dependencies: { h: H }, make: ctx => {
  st.inFrame = ctx
  ctx.addOnCloseListener(() => { st.frameClosed++ })
  return [provide(Echo, { echo: async x => success(x) }), provide(Ticks, {})]
} })
export const hImpl = Implementation.define(ns.implementationId('h'), { provides: [H], make: ctx => { st.inH = ctx; return [provide(H, { record: async n => { seen.push(n); return success(null) } })] } })
// A sandboxed pod whose source hears h's said through its own edge and yields each plus one.
export const relay = Implementation.define(ns.implementationId('relay'), { provides: [Ticks], dependencies: { h: H }, make: ctx => ({
  async *tick() { for await (const n of ctx.deps.h.said()) yield n + 1 },
}) })
export const acme = ns.provider([sImpl, hImpl, relay])
export const registry = Registry.create()
registry.add(acme)

export const dep = (wired = true, o: { relay?: boolean; deny?: boolean } = {}): AppDeployment => ({
  pods: { s: Pod.lazy(sImpl, { isolation: 'sandbox' }), h: Pod.eager(hImpl), ...(o.relay && { p: Pod.eager(relay, { isolation: 'sandbox' }) }) },
  runtimes: { r: { pods: ['s', 'h', ...(o.relay ? ['p'] : [])], ...(o.deny && { policy: { kind: 'rules' as const, rules: [{ deny: 'subscribe' as const, from: 's' }, { allow: '*' as const }] } }), subscriptions: [
    ...(o.relay ? [{ kind: 'call' as const, from: 'p', to: 'h' }] : []),
    ...(wired ? [{ kind: 'call' as const, from: 's', to: 'h' }] : []),
    { kind: 'pipe', from: 's', source: 't.Ticks/tick', to: 'h', target: 't.H/record' },
  ] } },
})

export const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
export const warns: string[] = []
export const consoleWarn = console.warn
export const reset = () => { console.warn = consoleWarn; st.inFrame = undefined; st.inH = undefined; st.view = undefined; st.frameClosed = 0; seen.length = 0; warns.length = 0 }

export async function harness(o: { readyMs?: number; silent?: boolean; relay?: boolean; deny?: boolean } = {}) {
  let disposed = 0, frame: MessagePort | undefined
  const applied = new Set<() => void>(), toasts: string[] = []
  const deps = {
    url: 'mem:acme', readyMs: o.readyMs,
    open(): Frame {
      const ch = new MessageChannel()
      frame = ch.port1
      if (!o.silent) serve(ch.port1, async (_, coord) => registry.implementation(coord)!, { render: (_, t) => { st.view = t } })
      return { port: ch.port2, ready: Promise.resolve(), dispose() { disposed++; ch.port1.close(); ch.port2.close() } }
    },
    edges: (pod: string) => edgesFor(app.deployment(), registry, pod), implementation: (c: string) => registry.implementation(c),
    onApplied: (fn: () => void) => { applied.add(fn); return () => { applied.delete(fn) } },
    warn: (r: string) => { toasts.push(r) },
    app: () => app,
  }
  const rts = AppDeployment.assemble(dep(true, { deny: o.deny }), registry)
  if (!rts.ok) throw new Error(rts.fail.reason)
  const made = await Application.create(rts.value, { isolate: (_, pod) => standIn(registry.implementation(pod.implementation)!, deps) })
  if (!made.ok) throw new Error(made.fail.reason)
  const app = made.value, events: AppEvent[] = []
  app.listen(e => { events.push(e); if (e.type === 'applied') for (const fn of applied) fn() })
  if (o.relay) must(await app.apply(dep(true, o)))   // added after create, as an import is: its frame needs the app
  return { app, events, toasts, disposed: () => disposed, frame: () => frame! }
}
