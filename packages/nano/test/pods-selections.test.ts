/** Pods, runtimes and an application (spec: 2026-11-14-pods-runtimes-application-design.md): see fixtures/acme-store.ts. */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Pod, Schema, Interface, Implementation, Op, provide, Provider, success, type NanoResult, type Selection } from '../src/index.ts'
import { Nothing, Store, Log, state, counter, store, logger, heard, watcher, checker, lonely, registry, ok, Sent, isSent, create, sent, tick, thrownBy } from './fixtures/acme-store.ts'

describe('selections and chains', () => {
  test("given a host call, when it is sent, then it is a call starting its own chain: correlation is its id, no cause", async () => {
    const { app, events } = await create({ pods: { c: Pod.lazy(counter) }, runtimes: { r: { pods: ['c'], subscriptions: [] } } })
    await app.call('r', 'c').inc(null)
    const [e] = events.filter(isSent) as [Sent]
    expect(e).toMatchObject({ kind: 'call', from: 'host', to: 'c', correlation: e.id })
    expect('cause' in e).toBe(false)
  })
  test('given a pod wired to two stores, when its code selects one, then it is not-unique, and all gives both in deployment order', async () => {
    let one: NanoResult<Selection<typeof Store>> | undefined, all: Selection<typeof Store>[] = []
    const picker = Implementation.define('acme2/picker', { provides: [Log], make: ctx => { one = ctx.one(Store); all = ctx.all(Store); return [provide(Log, { record: async () => success(null) })] } })
    const reg = registry(); reg.add(Provider.define('acme2', [picker]))
    await create({ pods: { p: Pod.eager(picker), a: Pod.lazy(store, { config: 'a' }), b: Pod.lazy(store, { config: 'b' }) },
      runtimes: { r: { pods: ['p', 'a', 'b'], subscriptions: [{ kind: 'call', from: 'p', to: 'b' }, { kind: 'call', from: 'p', to: 'a' }] } } }, reg)
    expect(one).toMatchObject({ ok: false, fail: { type: 'not-unique' } })
    expect(all.map(s => [s.pod, s.runtime])).toEqual([['b', 'r'], ['a', 'r']])
    expect(await all[1]!.call.save('x')).toEqual(success('a:x'))
  })
  test('given an event piped twice and heard by one on, when it is published, then all three deliveries are one chain: the first delivery\'s id, no cause', async () => {
    const pipe = (to: string) => ({ kind: 'pipe', from: 'db', source: 'acme.Store/saved', to, target: 'acme.Log/record' }) as const
    const { app, events } = await create({ pods: { w: Pod.eager(watcher), db: Pod.lazy(store, { config: 'db' }), l1: Pod.lazy(logger), l2: Pod.lazy(logger) },
      runtimes: { r: { pods: ['w', 'db', 'l1', 'l2'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }, pipe('l1'), pipe('l2')] } } })
    await app.call('r', 'db').save('x')
    await tick()
    const saved = events.filter(isSent).filter(e => e.kind !== 'call')
    expect(saved.map(e => `${e.kind}:${e.to}`)).toEqual(['pipe:l1', 'pipe:l2', 'on:w'])
    expect(saved.every(e => e.correlation === saved[0]!.id && !('cause' in e))).toBe(true)
  })
  test("given an on subscription to an action's results, when the host calls it, then the on delivery is caused by that call, in its chain", async () => {
    const results = Implementation.define('acme2/results', { provides: [Log], make: ctx => {
      ok(ctx.one(Store)).on(Store.ops.save, ({ output }) => { heard.push(output) })
      return [provide(Log, { record: async () => success(null) })]
    } })
    const reg = registry(); reg.add(Provider.define('acme2', [results]))
    const { app, events } = await create({ pods: { w: Pod.eager(results), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } }, reg)
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual(['db:x'])
    const [call, on] = [events.filter(isSent).find(e => e.kind === 'call')!, events.filter(isSent).find(e => e.kind === 'on')!]
    expect(on).toMatchObject({ from: 'db', to: 'w', port: 'acme.Store/save', correlation: call.id, cause: call.id })
  })
  test('given on with an op the selected pod lacks, when it subscribes, then it throws unknown-op and fn is never called', async () => {
    const wrong = Implementation.define('acme2/wrong', { provides: [Log], make: ctx => {
      heard.push(thrownBy(() => ok(ctx.one(Store)).on(Log.ops.record as never, () => { heard.push('never') }))?.fail.type ?? 'no throw')   // not an op of Store
      return [provide(Log, { record: async () => success(null) })]
    } })
    const reg = registry(); reg.add(Provider.define('acme2', [wrong]))
    const { app, events } = await create({ pods: { w: Pod.lazy(wrong), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } }, reg)
    expect(await app.call('r', 'w').record('a')).toEqual(success(null))   // builds w, which subscribes
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual(['unknown-op'])
  })
  test('given a selection kept past its build, when on is called after that build closed, then it throws not-found', async () => {
    let kept: Selection<typeof Store> | undefined
    const keeper = Implementation.define('acme2/keeper', { provides: [Log], make: ctx => { kept ??= ok(ctx.one(Store)); return [provide(Log, { record: async () => success(null) })] } })
    const reg = registry(); reg.add(Provider.define('acme2', [keeper]))
    const { app, events } = await create({ pods: { w: Pod.eager(keeper), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } }, reg)
    await app.restart('w')
    expect(thrownBy(() => kept!.on(Store.ops.save, () => { heard.push('late') }))?.fail.type).toBe('not-found')
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual([])
    expect(sent(events, 'on')).toEqual([])
  })
  // Behaviour 14.
  test('given a pod not wired to any store, when its code selects one, then one is not-found: its call is not made and on is not reached', async () => {
    const { app, events } = await create({ pods: { l: Pod.eager(lonely), db: Pod.lazy(store, { config: 'db' }) }, runtimes: { r: { pods: ['l', 'db'], subscriptions: [] } } })
    expect(await app.call('r', 'l').save('x')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.call('r', 'db').save('y')).toEqual(success('db:y'))   // db does emit saved
    await tick()
    expect(heard).toEqual([])
    expect(sent(events, 'on')).toEqual([])
  })
  // Behaviour 15.
  test('given a pipe cycle a.save → b.check → a.save, when the host saves, then it runs until check fails, each message chained to the host call', async () => {
    state.checks = 0
    const { app, events } = await create({ pods: { a: Pod.lazy(store, { config: 'a' }), b: Pod.lazy(checker) }, runtimes: { r: { pods: ['a', 'b'], subscriptions: [
      { kind: 'pipe', from: 'a', source: 'acme.Store/save', to: 'b', target: 'acme.Check/check' },
      { kind: 'pipe', from: 'b', source: 'acme.Check/check', to: 'a', target: 'acme.Store/save' },
    ] } } })
    await app.call('r', 'a').save('x')
    for (let i = 0; i < 10; i++) await tick()
    expect(state.checks).toBe(3)
    const all = events.filter(e => e.type === 'sent'), root = all[0]
    expect(root).toMatchObject({ kind: 'call', from: 'host', correlation: root.id })
    expect(root.cause).toBeUndefined()
    expect(all.slice(1).every(e => e.correlation === root.id && e.kind === 'pipe')).toBe(true)
    expect(all.slice(1).every((e, i) => e.cause === all[i].id)).toBe(true)
  })
})

describe('nothing throws', () => {
  test('given a host call whose input has a throwing getter, when it is sent, then it resolves to a Fail', async () => {
    const Rec = Schema.define(Type.Object({ x: Type.String() }), 'Rec')
    const Take = Interface.define('acme.Take', { take: Op.action(Rec, Nothing) })
    const taker = Implementation.define('acme2/taker', { provides: [Take], make: () => [provide(Take, { take: async () => success(null) })] })
    const reg = registry(); reg.add(Provider.define('acme2', [taker]))
    const { app } = await create({ pods: { t: Pod.lazy(taker) }, runtimes: { r: { pods: ['t'], subscriptions: [] } } }, reg)
    const input = { get x(): string { throw new Error('getter') } }
    expect(await app.call('r', 't').take(input)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
  test('given undefined for an op or a selector (a typo in plain JS), when a pod uses it, then on throws unknown-op, publish warns, one fails and all is empty', async () => {
    const seen: unknown[] = []
    const sloppy = Implementation.define('acme2/sloppy', { provides: [Log], make: async ctx => {
      const none = undefined as never
      seen.push(thrownBy(() => ok(ctx.one(Store)).on(none, () => { heard.push('never') }))?.fail.type)
      await ctx.publish(none, 1 as never)
      seen.push(ctx.one(none), ctx.all(none))
      return [provide(Log, { record: async () => success(null) })]
    } })
    const reg = registry(); reg.add(Provider.define('acme2', [sloppy]))
    const { app, events } = await create({ pods: { w: Pod.lazy(sloppy), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } }, reg)
    expect(await app.call('r', 'w').record('a')).toEqual(success(null))
    expect(events.filter(e => e.type === 'warning')).toHaveLength(1)
    expect(seen).toMatchObject(['unknown-op', { ok: false, fail: { type: 'not-found' } }, []])
  })
})
