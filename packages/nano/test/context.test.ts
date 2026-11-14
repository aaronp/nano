import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, portKey } from '../src/iface.ts'
import { failure, success } from '../src/result.ts'
import { implementation, provide } from '../src/implementation.ts'
import { provider } from '../src/provider.ts'
import { createRegistry } from '../src/registry.ts'
import { sel, selectorData } from '../src/selector.ts'
import type { NanoContext } from '../src/context.ts'
import type { Policy } from '../src/policy.ts'
import { Pod } from '../src/pod.ts'
import { createRuntime, type Runtime, type RuntimeEvent } from '../src/runtime/index.ts'

const Str = defineSchema('Str', Type.String())
const Num = defineSchema('Num', Type.Number())
const Rec = defineSchema('Rec', Type.Object({ key: Type.String(), value: Type.String() }))
const DB = iface('acme/db', { save: op.action('save', Rec, Str) })
const Ticks = iface('acme/ticks', { tick: op.source('tick', Num) })
const Log = iface('acme/log', { write: op.sink('write', Num) })
const Probe = iface('acme/probe', { probe: op.action('probe', Str, Str) })
const TICK = portKey(Ticks.coord, Ticks.ops.tick.coord)
const WRITE = portKey(Log.coord, Log.ops.write.coord)
const rec = { key: 'k', value: 'v' }

const A = 'acme/db/a#0', B = 'acme/db/b#0', C = 'acme/db/c#0', S = 'acme/db/s#0', M = 'acme/app/main#0', T = 'acme/clock/ticker#0', L = 'acme/log/mem#0'

/** Contexts are made by a runtime per invocation: this handler keeps the last one it was given. */
let caught: NanoContext | undefined
const probe = provide(Probe, { probe: async c => { caught = c; return success('') } })
/** The context `rt` invokes `coord` with. */
async function ctxOf(rt: Runtime, coord: string): Promise<NanoContext> {
  caught = undefined
  await rt.call(coord).probe('')
  if (!caught) throw new Error(`no context for ${coord}`)
  return caught
}

function setup(opts: { deny?: (from: string, to: string, data: unknown) => boolean } = {}) {
  const stores = new Map<string, Map<string, string>>()
  const trace: string[] = []
  const received = new Map<string, number[]>()
  const observed: RuntimeEvent[] = []
  const tags = new Map<string, Set<string>>()
  const db = (name: string, down = false, ms = 1) =>
    implementation(`acme/db/${name}`, {
      provides: [DB],
      make: () => {
        const store = new Map<string, string>()
        stores.set(name, store)
        return [provide(DB, {
          save: async (_c, r) => {
            trace.push(`start ${name}`)
            await new Promise(res => setTimeout(res, ms))
            trace.push(`end ${name}`)
            if (down) return failure('threw', `${name} is down`)
            store.set(r.key, r.value)
            return success(name)
          },
        })]
      },
    })
  const main = implementation('acme/app/main', { provides: [Probe], dependencies: { store: DB }, make: () => [probe] })
  const ticker = implementation('acme/clock/ticker', { provides: [Ticks, Probe], make: () => [probe] })
  // What each runtime's log received (one log per runtime here).
  const memLog = implementation('acme/log/mem', {
    provides: [Log],
    make: () => [provide(Log, { write: async (c, n) => { received.set(c.runtime, [...(received.get(c.runtime) ?? []), n]); return success(undefined) } })],
  })
  const registry = createRegistry()
  for (const p of [provider('acme/db', [db('a'), db('b'), db('c', true), db('s', false, 15)]), provider('acme/app', [main]), provider('acme/clock', [ticker]), provider('acme/log', [memLog])])
    registry.add(p)
  let denying = false
  const policy = { isAllowed: (from: string, to: string, data: unknown) => (denying && opts.deny?.(from, to, data) ? { approved: false as const, reason: `${to} refused` } : { approved: true as const }) }
  const rt = createRuntime('r1', { registry, policy, tagsOf: c => tags.get(c) ?? new Set() })
  rt.listen(e => observed.push(e))
  /** Register a new pod of `implementation` here: its coord. */
  const add = (implementation: string) => { const r = rt.register(Pod.create(registry.implementation(implementation)!)); if (!r.ok) throw new Error(r.fail.reason); return r.value }
  /** A consumer `main#0` with call subscriptions to the given DBs, in that order. */
  async function wire(...dbs: ('a' | 'b' | 'c' | 's')[]) {
    add('acme/app/main')
    for (const d of dbs) rt.subscribe({ kind: 'call', from: M, to: add(`acme/db/${d}`) })
    const ctx = await ctxOf(rt, M)
    denying = true
    return ctx
  }
  return { rt, registry, add, wire, stores, trace, received, observed, tags }
}

describe('one', () => {
  test('with no connection it fails missing-component naming the interface', async () => {
    const ctx = await setup().wire()
    expect(await ctx.one(DB, db => db.save(rec))).toMatchObject({ ok: false, fail: { type: 'missing-component', coord: 'acme/db' } })
  })
  test('with one connection it gives its result', async () => {
    const ctx = await setup().wire('a')
    expect(await ctx.one(DB, db => db.save(rec))).toEqual(success('a'))
  })
  test('with several it fails ambiguous', async () => {
    const ctx = await setup().wire('a', 'b')
    expect(await ctx.one(DB, db => db.save(rec))).toMatchObject({ ok: false, fail: { type: 'ambiguous' } })
  })
  test('a plain-data selector builds the client from the target', async () => {
    const ctx = await setup().wire('a')
    const r = await ctx.one({ implements: 'acme/db' }, db => (db as { save(r: unknown): Promise<never> }).save(rec))
    expect(r).toEqual(success('a'))
  })
  test('a connection whose target was removed is not a target', async () => {
    const { rt, wire } = setup()
    const ctx = await wire('a')
    rt.unregister(A)
    expect(await ctx.one(DB, db => db.save(rec))).toMatchObject({ ok: false, fail: { type: 'missing-component' } })
  })
})

describe('optional', () => {
  test('with no connection it gives none', async () => {
    const ctx = await setup().wire()
    expect(await ctx.optional(DB, db => db.save(rec))).toEqual(success({ none: true }))
  })
  test('with one connection it gives the result and which instance', async () => {
    const ctx = await setup().wire('a')
    expect(await ctx.optional(DB, db => db.save(rec))).toEqual(success({ value: 'a', from: A }))
  })
  test('with one failing connection it gives the fail', async () => {
    const ctx = await setup().wire('c')
    expect(await ctx.optional(DB, db => db.save(rec))).toEqual(failure('threw', 'c is down'))
  })
  test('with several it fails ambiguous', async () => {
    const ctx = await setup().wire('a', 'b')
    expect(await ctx.optional(DB, db => db.save(rec))).toMatchObject({ ok: false, fail: { type: 'ambiguous' } })
  })
})

describe('any', () => {
  test('with no connection it fails missing-component', async () => {
    const ctx = await setup().wire()
    expect(await ctx.any(DB, db => db.save(rec))).toMatchObject({ ok: false, fail: { type: 'missing-component' } })
  })
  test('with one it gives the result and which instance', async () => {
    const ctx = await setup().wire('a')
    expect(await ctx.any(DB, db => db.save(rec))).toEqual(success({ value: 'a', from: A }))
  })
  test('with several it calls all at once and the first success wins', async () => {
    const { wire, trace } = setup()
    const ctx = await wire('c', 'b')
    expect(await ctx.any(DB, db => db.save(rec))).toEqual(success({ value: 'b', from: B }))
    expect(trace.slice(0, 2)).toEqual(['start c', 'start b'])
  })
  test('an earlier success wins; the slower calls still complete and are booked', async () => {
    const { rt, wire } = setup()
    const ctx = await wire('s', 'a')
    expect(await ctx.any(DB, db => db.save(rec))).toEqual(success({ value: 'a', from: A }))
    expect(rt.books('s1')).toEqual({ calls: 0 })
    await new Promise(res => setTimeout(res, 25))
    expect(rt.books('s1')).toEqual({ calls: 1, last: success('s') })
    expect(rt.books('s2')).toEqual({ calls: 1, last: success('a') })
  })
  test('when none succeeds it fails all-failed listing each', async () => {
    const ctx = await setup().wire('c')
    expect(await ctx.any(DB, db => db.save(rec))).toEqual(failure('all-failed', `${C}: c is down`))
  })
})

describe('all', () => {
  test('with no connection it gives []', async () => {
    const ctx = await setup().wire()
    expect(await ctx.all(DB, db => db.save(rec))).toEqual([])
  })
  test('with one it gives its result', async () => {
    const ctx = await setup().wire('a')
    expect(await ctx.all(DB, db => db.save(rec))).toEqual([{ from: A, result: success('a') }])
  })
  test('with several it calls all at once and gives every result', async () => {
    const { wire, trace } = setup()
    const ctx = await wire('a', 'c')
    expect(await ctx.all(DB, db => db.save(rec))).toEqual([{ from: A, result: success('a') }, { from: C, result: failure('threw', 'c is down') }])
    expect(trace.slice(0, 2)).toEqual(['start a', 'start c'])
  })
  test('fan-out calls every connection', async () => {
    const { wire, stores } = setup()
    const ctx = await wire('a', 'b')
    await ctx.all(DB, db => db.save(rec))
    expect(stores.get('a')!.get('k')).toBe('v')
    expect(stores.get('b')!.get('k')).toBe('v')
  })
  test('a throwing fn is a threw result, not a rejection', async () => {
    const ctx = await setup().wire('a')
    expect(await ctx.all(DB, () => { throw new Error('oops') })).toEqual([{ from: A, result: failure('threw', `${A}: oops`) }])
  })
})

describe('first', () => {
  test('with no connection it fails missing-component', async () => {
    const ctx = await setup().wire()
    expect(await ctx.first(DB, db => db.save(rec))).toMatchObject({ ok: false, fail: { type: 'missing-component' } })
  })
  test('with one it gives its result', async () => {
    const ctx = await setup().wire('c')
    expect(await ctx.first(DB, db => db.save(rec))).toEqual(failure('threw', 'c is down'))
  })
  test('ordered verbs follow the saved order; reorder changes first', async () => {
    const { rt, wire, trace } = setup()
    const ctx = await wire('a', 'b')
    expect(await ctx.first(DB, db => db.save(rec))).toEqual(success('a'))
    expect(rt.reorder(M, ['s2', 's1']).ok).toBe(true)
    expect(await ctx.first(DB, db => db.save(rec))).toEqual(success('b'))
    expect(trace).toEqual(['start a', 'end a', 'start b', 'end b'])
  })
})

describe('fallback', () => {
  test('with no connection it fails missing-component', async () => {
    const ctx = await setup().wire()
    expect(await ctx.fallback(DB, db => db.save(rec))).toMatchObject({ ok: false, fail: { type: 'missing-component' } })
  })
  test('with one it gives the success and no failures', async () => {
    const ctx = await setup().wire('a')
    expect(await ctx.fallback(DB, db => db.save(rec))).toEqual(success({ value: 'a', from: A, failures: [] }))
  })
  test('with several it goes in order until one succeeds, keeping the failures before it', async () => {
    const { wire, trace } = setup()
    const ctx = await wire('c', 'a', 'b')
    expect(await ctx.fallback(DB, db => db.save(rec))).toEqual(
      success({ value: 'a', from: A, failures: [{ from: C, fail: { type: 'threw', reason: 'c is down' } }] }),
    )
    expect(trace).toEqual(['start c', 'end c', 'start a', 'end a'])
  })
  test('when none succeeds it fails all-failed', async () => {
    const ctx = await setup().wire('c')
    expect(await ctx.fallback(DB, db => db.save(rec))).toEqual(failure('all-failed', `${C}: c is down`))
  })
})

describe('each', () => {
  test('with no connection it gives []', async () => {
    const ctx = await setup().wire()
    expect(await ctx.each(DB, db => db.save(rec))).toEqual([])
  })
  test('with one it gives its result', async () => {
    const ctx = await setup().wire('b')
    expect(await ctx.each(DB, db => db.save(rec))).toEqual([{ from: B, result: success('b') }])
  })
  test('with several it calls in saved order, waiting for each', async () => {
    const { wire, trace } = setup()
    const ctx = await wire('c', 'a')
    expect(await ctx.each(DB, db => db.save(rec))).toEqual([{ from: C, result: failure('threw', 'c is down') }, { from: A, result: success('a') }])
    expect(trace).toEqual(['start c', 'end c', 'start a', 'end a'])
  })
})

describe('selectors at run time', () => {
  test('a tag selector sees a tag added after the call before', async () => {
    const { wire, tags } = setup()
    const ctx = await wire('a', 'b')
    const cache = sel(DB, { tags: ['cache'] })
    tags.set(A, new Set(['cache']))
    expect(await ctx.one(cache, db => db.save(rec))).toEqual(success('a'))
    tags.set(B, new Set(['cache']))
    expect(await ctx.one(cache, db => db.save(rec))).toMatchObject({ ok: false, fail: { type: 'ambiguous' } })
  })
  test('sel keeps the interface and adds the selector fields', () => {
    const s = sel(DB, { tags: ['cache'] })
    expect(s.ops).toBe(DB.ops)
    expect(s).toMatchObject({ implements: 'acme/db', tags: ['cache'] })
    expect(selectorData(s)).toEqual({ implements: 'acme/db', tags: ['cache'] })
  })
})

describe('policy and books', () => {
  test("a denied message fails denied and isn't delivered", async () => {
    const { rt, wire, stores } = setup({ deny: (_f, to) => to === B })
    const ctx = await wire('b')
    expect(await ctx.one(DB, db => db.save(rec))).toEqual(failure('denied', `${B} refused`))
    expect(stores.get('b')!.size).toBe(0)
    expect(rt.books('s1')).toEqual({ calls: 0 })
  })
  test('books count calls and keep the last result', async () => {
    const { rt, wire } = setup()
    const ctx = await wire('a', 'c')
    await ctx.all(DB, db => db.save(rec))
    await ctx.first(DB, db => db.save(rec))
    expect(rt.books('s1')).toEqual({ calls: 2, last: success('a') })
    expect(rt.books('s2')).toEqual({ calls: 1, last: failure('threw', 'c is down') })
    expect(rt.books('nope')).toBeUndefined()
  })
  test('a call in flight when its subscription goes does not bring the books back', async () => {
    const { rt, wire } = setup()
    const ctx = await wire('s')
    const call = ctx.one(DB, db => db.save(rec))
    rt.unsubscribe('s1')
    rt.subscribe({ kind: 'call', from: M, to: S })
    await call
    expect(rt.books('s1')).toEqual({ calls: 0 })
  })
  test('a call in flight when its subscription is retargeted is not booked on it', async () => {
    const { rt, add, wire } = setup()
    const ctx = await wire('s')
    add('acme/db/a')
    const call = ctx.one(DB, db => db.save(rec))
    rt.retarget('s1', A)
    await call
    expect(rt.books('s1')).toEqual({ calls: 0 })
  })
  test('a typed client has only its interface’s ops', async () => {
    const ctx = await setup().wire('a')
    // @ts-expect-error: DB has no op `nope`
    expect(await ctx.one(DB, db => db.nope(rec))).toMatchObject({ ok: false, fail: { type: 'threw' } })
  })
  test('unsubscribing drops the books', async () => {
    const { rt, wire } = setup()
    const ctx = await wire('a')
    await ctx.one(DB, db => db.save(rec))
    rt.unsubscribe('s1')
    expect(rt.books('s1')).toBeUndefined()
  })
})

describe('publish', () => {
  /** A ticker wired to a log in r1, and the context r1 invokes the ticker with. */
  async function wired() {
    const s = setup()
    s.add('acme/clock/ticker'); s.add('acme/log/mem')
    s.rt.subscribe({ kind: 'event', from: T, source: TICK, to: L, target: WRITE })
    return { ...s, ctx: await ctxOf(s.rt, T) }
  }
  /** The ticker also registered in r2 (with this policy), wired to r2's own log. */
  function inR2({ rt, registry }: Awaited<ReturnType<typeof wired>>, policy?: Policy) {
    const r2 = createRuntime('r2', { registry, ...(policy && { policy }) })
    const seen: RuntimeEvent[] = []
    r2.listen(e => seen.push(e))
    const t = r2.register(rt.pod(T)!), l = r2.register(Pod.create(registry.implementation('acme/log/mem')!))
    if (!t.ok || !l.ok) throw new Error('not registered')
    r2.subscribe({ kind: 'event', from: t.value, source: TICK, to: l.value, target: WRITE })
    return { r2, seen, t: t.value }
  }
  test('publish reaches every live event subscription, in each runtime the pod is in', async () => {
    const w = await wired()
    const { r2, t } = inR2(w)
    await w.ctx.publish(Ticks.ops.tick, 1)
    expect(w.received.get('r1')).toEqual([1])
    expect(w.received.get('r2')).toEqual([1])
    expect(w.rt.books('s1')).toEqual({ calls: 1, last: success(undefined) })
    expect(r2.books('s1')).toEqual({ calls: 1, last: success(undefined) })
    r2.unregister(t)
    await w.ctx.publish(Ticks.ops.tick, 2)
    expect(w.received.get('r1')).toEqual([1, 2])
    expect(w.received.get('r2')).toEqual([1])
  })
  test('once the pod is unregistered from every runtime, its publishes go nowhere', async () => {
    const w = await wired()
    const { r2, t } = inR2(w)
    w.rt.unregister(T); r2.unregister(t)
    await w.ctx.publish(Ticks.ops.tick, 1)
    expect(w.received.size).toBe(0)
  })
  test("a runtime whose policy denies blocks only its own deliveries", async () => {
    const w = await wired()
    const { r2 } = inR2(w, { isAllowed: (_f, _t, d) => (typeof d === 'number' ? { approved: false, reason: 'no' } : { approved: true }) })
    await w.ctx.publish(Ticks.ops.tick, 1)
    expect(w.received.get('r1')).toEqual([1])
    expect(w.received.get('r2')).toBeUndefined()
    expect(w.rt.books('s1')).toEqual({ calls: 1, last: success(undefined) })
    expect(r2.books('s1')).toEqual({ calls: 0 })
  })
  test('a policy that throws is a denial, observed; publish still resolves', async () => {
    const w = await wired()
    const { seen } = inR2(w, { isAllowed: (_f, _t, d) => { if (typeof d === 'number') throw new Error('bad policy'); return { approved: true } } })
    await w.ctx.publish(Ticks.ops.tick, 1)
    expect(w.received.get('r1')).toEqual([1])
    expect(w.received.get('r2')).toBeUndefined()
    expect(seen).toContainEqual({ type: 'failure', coord: T, reason: 'policy threw: bad policy' })
    expect(seen.filter(e => e.type === 'denied')).toMatchObject([{ reason: 'policy threw: bad policy' }])
  })
  test('with no event subscription nothing happens', async () => {
    const { rt, ctx, received } = await wired()
    rt.unsubscribe('s1')
    await ctx.publish(Ticks.ops.tick, 1)
    expect(received.size).toBe(0)
  })
  test('data that does not fit the op is dropped and observed as a failure', async () => {
    const { ctx, received, observed } = await wired()
    await ctx.publish(Ticks.ops.tick, 'x')
    expect(received.size).toBe(0)
    expect(observed).toContainEqual({ type: 'failure', coord: T, reason: `${T}: tick data does not fit its schema` })
  })
  test('an op that is not one of the pod’s sources is dropped and observed', async () => {
    const { ctx, observed } = await wired()
    await ctx.publish(Log.ops.write, 1)
    expect(observed).toContainEqual({ type: 'failure', coord: T, reason: `${T}: write is not a source of this instance` })
  })
})

describe('the runtimes a context sees', () => {
  test("a context names its pod's coord and the invoking runtime, and every runtime the pod is in", async () => {
    const w = await wired2()
    const ctx = await ctxOf(w.r2, M)
    expect([ctx.instance, ctx.runtime, ctx.runtimes]).toEqual([M, 'r2', ['r1', 'r2']])
  })
  test("a selector's runtime narrows the search to that runtime", async () => {
    const { ctx } = await wired2()
    expect(await ctx.one(DB, db => db.save(rec))).toMatchObject({ ok: false, fail: { type: 'ambiguous' } })
    expect(await ctx.one(sel(DB, { runtime: 'r2' }), db => db.save(rec))).toEqual(success('b'))
    expect(await ctx.one({ implements: 'acme/db', runtime: 'r1' }, db => (db as { save(r: unknown): Promise<never> }).save(rec))).toEqual(success('a'))
  })
  /** `main` wired to db a in r1 and, registered in r2 too, to db b there. */
  async function wired2() {
    const s = setup()
    const ctx = await s.wire('a')
    const r2 = createRuntime('r2', { registry: s.registry })
    const m = r2.register(s.rt.pod(M)!), b = r2.register(Pod.create(s.registry.implementation('acme/db/b')!))
    if (!m.ok || !b.ok) throw new Error('not registered')
    r2.subscribe({ kind: 'call', from: m.value, to: b.value })
    return { ...s, r2, ctx }
  }
})

describe('dependencies', () => {
  test('listDependencies and hasDependencies reflect the live connections', async () => {
    const { rt, add, wire } = setup()
    const ctx = await wire()
    expect(ctx.listDependencies()).toEqual([{ role: 'store', selector: { implements: 'acme/db' }, satisfied: false, targets: [] }])
    expect(ctx.hasDependencies()).toBe(false)
    rt.subscribe({ kind: 'call', from: M, to: add('acme/db/a') })
    expect(ctx.listDependencies()).toEqual([{ role: 'store', selector: { implements: 'acme/db' }, satisfied: true, targets: [A] }])
    expect(ctx.hasDependencies()).toBe(true)
    expect(ctx.hasDependencies('store')).toBe(true)
    expect(ctx.hasDependencies('nope')).toBe(false)
    rt.unregister(A)
    expect(ctx.hasDependencies('store')).toBe(false)
  })
  test('an instance with no dependencies has them all', async () => {
    const { rt, add } = setup()
    expect((await ctxOf(rt, add('acme/clock/ticker'))).hasDependencies()).toBe(true)
  })
})
