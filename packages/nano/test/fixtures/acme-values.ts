/** Shared fixtures of the application-* tests: Acme implementations and the helpers that make a live Application. */
import { test } from 'bun:test'
import { Type } from 'typebox'
import { Application, AppDeployment, Registry, Schema, Interface, Implementation, Op, provide, Provider, Selector, success, type AppEvent, type Policy } from '../../src/index.ts'

export const Str = Schema.define(Type.String(), 'Str')
export const Num = Schema.define(Type.Integer(), 'Num')
export const Nothing = Schema.define(Type.Null(), 'Nothing')
export const Rows = Schema.define(Type.Array(Type.String()), 'Rows')

export const Counter = Interface.define('acme.Counter', { inc: Op.action(Nothing, Num) })
export const KV = Interface.define('acme.KV', { get: Op.action(Str, Str), put: Op.action(Str, Nothing) })
export const Send = Interface.define('acme.Send', { send: Op.action(Str, Nothing) })
export const Ticks = Interface.define('acme.Ticks', { tick: Op.event(Num) })
export const Log = Interface.define('acme.Log', { record: Op.action(Num, Nothing) })
export const DB = Interface.define('acme.DB', { all: Op.action(Nothing, Rows), insert: Op.action(Rows, Nothing) })
export const Run = Interface.define('acme.Run', { run: Op.action(Nothing, Num) })
export const Bad = Interface.define('acme.Bad', { go: Op.action(Str, Num) })

export const builds: string[] = []
/** A counter whose state is a closure: 1, 2, 3 … per instance. Records each build. */
export const counter = Implementation.define('acme/counter', { provides: [Counter], make: (ctx) => {
  builds.push(ctx.self); let n = 0
  return [provide(Counter, { inc: async () => success(++n) })]
} })
/** Mutable fixture state; tests reset it, so files stay independent under --isolate. */
export const state = { failNext: 0 }
export const flaky = Implementation.define('acme/flaky', { provides: [Counter], make: () => {
  if (state.failNext > 0) { state.failNext--; throw new Error('not yet') }
  return [provide(Counter, { inc: async () => success(1) })]
} })
export const kv = Implementation.define('acme/kv', { provides: [KV], make: () => {
  const m = new Map<string, string>()
  return [provide(KV, { get: async k => success(m.get(k) ?? ''), put: async k => { m.set(k, 'v'); return success(null) } })]
} })
/** Sends by putting into whichever KV it is wired to; never names a runtime. */
export const sender = Implementation.define('acme/sender', { provides: [Send], dependencies: { store: KV }, make: ctx => [provide(Send, {
  send: async msg => { const s = ctx.one(KV); return s.ok ? s.value.call.put(msg) : s },
})] })
/** Falls back to a local note when no KV is wired. */
export const adaptive = Implementation.define('acme/adaptive', { provides: [Send], dependencies: { store: KV }, make: ctx => {
  const local: string[] = []
  return [provide(Send, { send: async msg => {
    if (ctx.all(KV).length === 0) { local.push(msg); return success(null) }
    const s = ctx.one(KV)
    return s.ok ? s.value.call.put(msg) : s
  } })]
} })
export const ticker = Implementation.define('acme/ticker', { provides: [Ticks], make: () => [] })
export const logged: number[] = []
export const log = Implementation.define('acme/log', { provides: [Log], make: () => [provide(Log, { record: async n => { logged.push(n); return success(null) } })] })
export const db = Implementation.define('acme/db', { provides: [DB], make: (_ctx, seed: string[] = []) => {
  const rows = [...seed]
  return [provide(DB, { all: async () => success([...rows]), insert: async more => { rows.push(...more); return success(null) } })]
} })
/** Copies rows from config.from to config.to, naming runtimes only through config. */
export const migrate = Implementation.define('acme/migrate', { provides: [Run], dependencies: { db: DB }, make: (ctx, cfg) => [provide(Run, { run: async () => {
  const from = ctx.one(Selector.of(DB, { runtime: cfg.from })), to = ctx.one(Selector.of(DB, { runtime: cfg.to }))
  if (!to.ok) return to
  if (!from.ok) return from
  const rows = await from.value.call.all(null)
  if (!rows.ok) return rows
  const put = await to.value.call.insert(rows.value)
  return put.ok ? success(rows.value.length) : put
} })] })
export const careless = Implementation.define('acme/careless', { provides: [Run], dependencies: { db: DB }, make: ctx => [provide(Run, { run: async () => {
  const d = ctx.one(DB); return d.ok ? success(0) : d
} })] })
/** Each instance's first call waits until the test opens every gate. */
export const gates: (() => void)[] = []
export const openAll = () => { for (const g of gates.splice(0)) g() }
export const gated = Implementation.define('acme/gated', { provides: [Counter], make: () => {
  let n = 0
  return [provide(Counter, { inc: async () => { const mine = ++n; if (mine === 1) await new Promise<void>(r => gates.push(r)); return success(mine) } })]
} })
export const bad = Implementation.define('acme/bad', { provides: [Bad], make: () => [provide(Bad, { go: async (x: string) => {
  if (x === 'out') return success('not a number' as unknown as number)
  if (x === 'slow') return new Promise(() => {})
  if (x === 'throw') throw new Error('bang')
  return success(1)
} })] })
export const seen: string[] = []
export const where = Implementation.define('acme/where', { provides: [Counter], make: ctx => [provide(Counter, { inc: async () => { seen.splice(0, seen.length, ...ctx.runtimes); return success(1) } })] })

export const registry = () => {
  const r = Registry.create()
  r.add(Provider.define('acme', [counter, flaky, kv, sender, adaptive, ticker, log, db, migrate, careless, gated, bad, where]))
  return r
}
export const ok = <T>(r: { ok: boolean; value?: T; fail?: { reason: string } }): T => { if (!r.ok) throw new Error(r.fail!.reason); return r.value as T }
/** `d` assembled with `reg`, then made live: the first failure of either. */
export const create = async (d: unknown, opts: { policies?: Record<string, Policy>; timeoutMs?: number } = {}, reg = registry()) => {
  const runtimes = AppDeployment.assemble(d, reg)
  return runtimes.ok ? Application.create(runtimes.value, opts) : runtimes
}
/** A live application and everything on its stream. */
export const live = async (deployment: unknown, opts: { policies?: Record<string, Policy>; timeoutMs?: number } = {}) => {
  const app = ok(await create(deployment, opts))
  const events: AppEvent[] = []
  app.listen(e => events.push(e))
  return { app, events }
}
export const sent = (events: AppEvent[], runtime?: string) =>
  events.flatMap(e => (e.type === 'sent' && (!runtime || e.runtime === runtime) ? [`${e.from}->${e.to}`] : []))
export const one = (pods: AppDeployment['pods'], subscriptions: AppDeployment['runtimes'][string]['subscriptions'] = [], extra = {}) => ({ pods, runtimes: { r: { pods: Object.keys(pods), subscriptions } }, ...extra })
