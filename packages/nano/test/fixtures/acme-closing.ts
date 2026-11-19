/** Shared fixtures of the runtime-slice and closing tests: counters that log their builds and closes. */
import { Type } from 'typebox'
import { Application, AppDeployment, Registry, Schema, Interface, Implementation, Op, provide, Provider, success, type AppEvent, type NanoResult } from '../../src/index.ts'

export const Num = Schema.define(Type.Integer(), 'Num')
export const Nothing = Schema.define(Type.Null(), 'Nothing')
export const Counter = Interface.define('acme.Counter', { inc: Op.action(Nothing, Num) })

/** What happened, in order, across every instance: 'build <pod>', 'close <pod> <reason>', 'tick <pod>'. */
export const log: string[] = []
/** A counter that logs its build and its close. */
export const counter = Implementation.define('acme/counter', { provides: [Counter], make: ctx => {
  log.push(`build ${ctx.self}`); let n = 0
  ctx.addOnCloseListener(({ reason }) => { log.push(`close ${ctx.self} ${reason}`) })
  return [provide(Counter, { inc: async () => success(++n) })]
} })
/** Ticks every 5ms until closed. */
export const ticker = Implementation.define('acme/ticker', { provides: [Counter], make: ctx => {
  const t = setInterval(() => log.push(`tick ${ctx.self}`), 5)
  ctx.addOnCloseListener(() => clearInterval(t))
  return [provide(Counter, { inc: async () => success(0) })]
} })
/** Adds a close listener, then throws. */
export const halfBuilt = Implementation.define('acme/half', { provides: [Counter], make: ctx => {
  ctx.addOnCloseListener(({ reason }) => { log.push(`close ${ctx.self} ${reason}`) })
  throw new Error('half built')
} })
/** Three close listeners: one throws, one hangs, one logs. */
export const messy = Implementation.define('acme/messy', { provides: [Counter], make: ctx => {
  ctx.addOnCloseListener(() => { throw new Error('bad close') })
  ctx.addOnCloseListener(() => new Promise(() => {}))
  ctx.addOnCloseListener(({ reason }) => { log.push(`close ${ctx.self} ${reason}`) })
  return [provide(Counter, { inc: async () => success(1) })]
} })

/** Logs its build; its close listener takes 20ms, then logs. */
export const slowClose = Implementation.define('acme/slowclose', { provides: [Counter], make: ctx => {
  log.push(`build ${ctx.self}`)
  ctx.addOnCloseListener(async ({ reason }) => { await wait(20); log.push(`close ${ctx.self} ${reason}`) })
  return [provide(Counter, { inc: async () => success(1) })]
} })

/** Takes 30ms to build, then logs; its inc logs too. */
export const slowMake = Implementation.define('acme/slowmake', { provides: [Counter], make: async ctx => {
  await wait(30); log.push(`made ${ctx.self}`)
  return [provide(Counter, { inc: async () => { log.push('handler ran'); return success(1) } })]
} })

export const registry = () => { const r = Registry.create(); r.add(Provider.define('acme', [counter, ticker, halfBuilt, messy, slowClose, slowMake])); return r }
export const ok = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
export const live = async (deployment: AppDeployment, opts: { timeoutMs?: number } = {}) => {
  log.length = 0
  const app = ok(await Application.create(ok(AppDeployment.assemble(deployment, registry())), opts))
  const events: AppEvent[] = []
  app.listen(e => events.push(e))
  return { app, events }
}
export const one = (pods: AppDeployment['pods']): AppDeployment => ({ pods, runtimes: { r: { pods: Object.keys(pods), subscriptions: [] } } })
export const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
