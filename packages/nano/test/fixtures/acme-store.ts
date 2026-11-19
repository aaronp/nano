/** Shared fixtures of the pods-* tests: Acme implementations and the helpers that assemble a live Application. */
import { Type } from 'typebox'
import { Application, AppDeployment, Registry, Schema, failure, Interface, Implementation, Op, provide, Provider, Selector, success, type AppEvent, type NanoResult } from '../../src/index.ts'

export const Str = Schema.define(Type.String(), 'Str')
export const Num = Schema.define(Type.Integer(), 'Num')
export const Nothing = Schema.define(Type.Null(), 'Nothing')
export const Counter = Interface.define('acme.Counter', { inc: Op.action(Nothing, Num) })
export const Store = Interface.define('acme.Store', { save: Op.action(Str, Str), saved: Op.event(Str) })
export const Log = Interface.define('acme.Log', { record: Op.action(Str, Nothing) })
export const App = Interface.define('acme.App', { save: Op.action(Str, Str) })

/** Mutable fixture state; tests reset it, so files stay independent under --isolate. */
export const state = { n: 0, checks: 0, slowOpen: (_v?: unknown) => {} }
export const counter = Implementation.define('acme/counter', { provides: [Counter], make: () => { let c = 0; state.n++; return [provide(Counter, { inc: async () => success(++c) })] } })
/** A store whose name is its config; `save('bad')` fails; every save publishes `saved`. */
export const store = Implementation.define('acme/store', { provides: [Store], make: (ctx, name: string) => [provide(Store, { save: async s => {
  if (s === 'bad') return failure('invalid-input', 'bad')
  await ctx.publish(Store.ops.saved, `${name}:${s}`)
  return success(`${name}:${s}`)
} })] })
export const logged: string[] = []
export const logger = Implementation.define('acme/log', { provides: [Log], make: () => [provide(Log, { record: async s => { logged.push(s); return success(null) } })] })
export const slowLogger = Implementation.define('acme/slowlog', { provides: [Log], make: () => [provide(Log, { record: async s => { await new Promise(r => { state.slowOpen = r }); logged.push(s); return success(null) } })] })
/** Domain-level app: its code saves through whichever Store its call edge points at. */
export const appImpl = Implementation.define('acme/app', { provides: [App], dependencies: { store: Store }, make: ctx => [provide(App, {
  save: async s => { const st = ctx.one(Store); return st.ok ? st.value.call.save(s) : st },   // a failed selection is its Fail
})] })
/** Subscribes in code to its store's `saved` events. */
export const heard: string[] = []
export const watcher = Implementation.define('acme/watcher', { provides: [Log], dependencies: { store: Store }, make: ctx => {
  const st = ctx.one(Store)
  if (st.ok) st.value.on(Store.ops.saved, ({ output }) => { heard.push(output) })
  return [provide(Log, { record: async () => success(null) })]
} })

export const Check = Interface.define('acme.Check', { check: Op.action(Str, Str) })
/** Passes its input on, failing from the third call: the loop ends there. */
export const checker = Implementation.define('acme/check', { provides: [Check], make: () => [provide(Check, { check: async s => (++state.checks >= 3 ? failure('invalid-input', 'enough') : success(s)) })] })
/** Its code asks for a store it isn't wired to. */
export const lonely = Implementation.define('acme/lonely', { provides: [App], dependencies: { store: Store }, make: ctx => {
  const st = ctx.one(Store)
  if (st.ok) st.value.on(Store.ops.saved, () => { heard.push('never') })
  return [provide(App, { save: async s => { const st = ctx.one(Store); return st.ok ? st.value.call.save(s) : st } })]
} })

/** Counts the stores wired to it that are tagged primary. */
export const primaries = Implementation.define('acme/primaries', { provides: [Counter], dependencies: { store: Store }, make: ctx => [provide(Counter, {
  inc: async () => success(ctx.all(Selector.of(Store, { tags: ['primary'] })).length),
})] })

export const registry = () => { const r = Registry.create(); r.add(Provider.define('acme', [counter, store, logger, slowLogger, appImpl, watcher, checker, lonely, primaries])); return r }
export const ok = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
export type Sent = Extract<AppEvent, { type: 'sent' }>
export const isSent = (e: AppEvent): e is Sent => e.type === 'sent'
/** `d` assembled and made live, with everything on its stream. */
export const create = async (d: unknown, reg = registry()) => {
  logged.length = 0; heard.length = 0
  const app = ok(await Application.create(ok(AppDeployment.assemble(d, reg)), {}))
  const events: AppEvent[] = []
  app.listen(e => events.push(e))
  return { app, events }
}
export const sent = (events: AppEvent[], kind?: Sent['kind']) => events.filter(isSent).filter(e => !kind || e.kind === kind).map(e => `${e.runtime}:${e.from}->${e.to}`)
export const tick = () => new Promise(r => setTimeout(r, 0))

export const thrownBy = (f: () => unknown) => { try { f() } catch (e) { return e as Error & { fail: { type: string } } } }
