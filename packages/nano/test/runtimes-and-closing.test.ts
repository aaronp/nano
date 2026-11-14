// @ts-nocheck — live runtimes and closing aren't built yet; remove when they land
/**
 * A runtime's slice of the application and closing (specs: 2026-11-14-values-and-application-design.md "Closing an
 * instance", behaviours 18–24, as revised by 2026-11-14-pods-runtimes-application-design.md), written first. An instance is closed on
 * restart, removal, change, a failed build and `app.close()`, running its `ctx.addOnCloseListener` listeners.
 */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import * as nano from '../src/index.ts'

const { Pod, Application, assemble, implementation, provide, provider, createRegistry, defineSchema, iface, op, success } = nano as any

const Num = defineSchema('Num', Type.Integer())
const Nothing = defineSchema('Nothing', Type.Null())
const Counter = iface('acme.Counter', { inc: op.action('inc', Nothing, Num) })

/** What happened, in order, across every instance: 'build <pod>', 'close <pod> <reason>', 'tick <pod>'. */
let log: string[] = []
/** A counter that logs its build and its close. */
const counter = implementation('acme/counter', { provides: [Counter], make: ctx => {
  log.push(`build ${ctx.self}`); let n = 0
  ctx.addOnCloseListener(({ reason }) => { log.push(`close ${ctx.self} ${reason}`) })
  return [provide(Counter, { inc: async () => success(++n) })]
} })
/** Ticks every 5ms until closed. */
const ticker = implementation('acme/ticker', { provides: [Counter], make: ctx => {
  const t = setInterval(() => log.push(`tick ${ctx.self}`), 5)
  ctx.addOnCloseListener(() => clearInterval(t))
  return [provide(Counter, { inc: async () => success(0) })]
} })
/** Adds a close listener, then throws. */
const halfBuilt = implementation('acme/half', { provides: [Counter], make: ctx => {
  ctx.addOnCloseListener(({ reason }) => { log.push(`close ${ctx.self} ${reason}`) })
  throw new Error('half built')
} })
/** Three close listeners: one throws, one hangs, one logs. */
const messy = implementation('acme/messy', { provides: [Counter], make: ctx => {
  ctx.addOnCloseListener(() => { throw new Error('bad close') })
  ctx.addOnCloseListener(() => new Promise(() => {}))
  ctx.addOnCloseListener(({ reason }) => { log.push(`close ${ctx.self} ${reason}`) })
  return [provide(Counter, { inc: async () => success(1) })]
} })

const registry = () => { const r = createRegistry(); r.add(provider('acme', [counter, ticker, halfBuilt, messy])); return r }
const ok = r => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const live = async (deployment, opts = {}) => {
  log = []
  const app = ok(await Application.create(ok(assemble(deployment, registry())), opts))
  const events = []
  app.listen(e => events.push(e))
  return { app, events }
}
const one = pods => ({ pods, runtimes: { r: { pods: Object.keys(pods), subscriptions: [] } } })
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

describe("a runtime's slice", () => {
  // Revised behaviour 17: no live runtime object; app.call and listen filtered by runtime. Waits for Task 3 (`counter`
  // adds a close listener) and Task 4 (`sent` carries `kind`).
  test.todo('given two runtimes, when the host calls through one, then only that runtime records it, and unknown runtimes or unplaced pods are not-found', async () => {
    const { app, events } = await live({ pods: { c: Pod.lazy(counter), d: Pod.lazy(counter) },
      runtimes: { chat: { pods: ['c'], subscriptions: [] }, other: { pods: ['c', 'd'], subscriptions: [] } } })
    expect(await app.call('chat', 'c').inc(null)).toEqual(success(1))
    expect(events.filter(e => e.runtime === 'chat').map(e => e.type)).toEqual(['sent'])
    expect(events.filter(e => e.type === 'sent').map(e => `${e.runtime}:${e.kind}:${e.from}->${e.to}`)).toEqual(['chat:call:host->c'])
    expect(events.filter(e => e.runtime === 'other')).toEqual([])
    expect(await app.call('nope', 'c').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.call('chat', 'd').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
})

describe('closing', () => {
  // Behaviour 18 and 24.
  test.todo('given a built counter, when it is restarted, then its close listener runs with restarted before the new instance is built, and the stream shows closed', async () => {
    const { app, events } = await live(one({ c: Pod.eager(counter) }))
    await app.restart('c')
    expect(log).toEqual(['build c', 'close c restarted', 'build c'])
    expect(events).toContainEqual({ type: 'closed', pod: 'c', reason: 'restarted' })
  })
  // Behaviour 19.
  test.todo('given built pods, when apply removes one, changes one and only rewires the rest, then only the removed and changed ones close, with their reasons', async () => {
    const d = { pods: { gone: Pod.eager(counter), changed: Pod.eager(counter, { config: 1 }), kept: Pod.eager(counter) },
      runtimes: { r: { pods: ['gone', 'changed', 'kept'], subscriptions: [] }, s: { pods: [], subscriptions: [] } } }
    const { app } = await live(d)
    log = []
    ok(await app.apply({ pods: { changed: Pod.eager(counter, { config: 2 }), kept: d.pods.kept },
      runtimes: { r: { pods: ['changed', 'kept'], subscriptions: [] }, s: { pods: ['kept'], subscriptions: [] } } }))
    expect(log.sort()).toEqual(['build changed', 'close changed changed', 'close gone removed'])
  })
  // Behaviour 20.
  test.todo('given an application with built and unbuilt pods, when it is closed, then built ones close with closed, later calls are not-found, apply and restart are refused, and closing again does nothing', async () => {
    const { app } = await live(one({ a: Pod.eager(counter), b: Pod.lazy(counter) }))
    expect(await app.close()).toEqual(success(undefined))
    expect(log).toEqual(['build a', 'close a closed'])
    expect(await app.call('r', 'a').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.restart('a')).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(await app.apply(app.deployment())).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(await app.close()).toEqual(success(undefined))
    expect(log).toEqual(['build a', 'close a closed'])
  })
  // Behaviour 21.
  test.todo('given a factory that adds a close listener and then throws, when it is built, then the listener runs with closed', async () => {
    const { app } = await live(one({ h: Pod.lazy(halfBuilt) }))
    expect(await app.call('r', 'h').inc(null)).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(log).toEqual(['close h closed'])
  })
  // Behaviour 22.
  test.todo('given close listeners that throw and hang, when the application closes, then each is a failure, the others still run and close resolves', async () => {
    const { app, events } = await live(one({ m: Pod.eager(messy) }), { timeoutMs: 20 })
    expect(await app.close()).toEqual(success(undefined))
    expect(log).toEqual(['close m closed'])
    expect(events.filter(e => e.type === 'failure' && e.pod === 'm')).toHaveLength(2)
  })
  // Behaviour 23.
  test.todo('given a ticker started in make, when the application closes, then nothing ticks after close', async () => {
    const { app } = await live(one({ t: Pod.eager(ticker) }))
    await wait(20)
    await app.close()
    const after = log.length
    await wait(20)
    expect(after).toBeGreaterThan(0)
    expect(log.length).toBe(after)
  })
})
