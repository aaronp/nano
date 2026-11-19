/** Pods, runtimes and an application (spec: 2026-11-14-pods-runtimes-application-design.md): see fixtures/acme-store.ts. */
import { describe, expect, test } from 'bun:test'
import { Pod, AppDeployment, failure, Implementation, provide, Provider, success, type Selection } from '../src/index.ts'
import { Store, Log, store, logged, logger, heard, watcher, registry, ok, create, sent, tick, thrownBy } from './fixtures/acme-store.ts'

describe('subscriptions in code', () => {
  const watched = (): AppDeployment => ({ pods: { w: Pod.eager(watcher), db: Pod.lazy(store, { config: 'db' }) },
    runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } })
  // Behaviour 9.
  test("given a watcher whose factory subscribes to its store's saved event, when the store saves, then the watcher hears it as an on message", async () => {
    const { app, events } = await create(watched())
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual(['db:x'])
    expect(sent(events, 'on')).toEqual(['r:db->w'])
  })
  // Behaviour 10.
  test('given a watcher subscribed in code, when it restarts, then its old subscription stops and the new instance subscribes afresh', async () => {
    const { app } = await create(watched())
    await app.restart('w')
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual(['db:x'])   // once: the old instance's subscription stopped
  })
  test('given a watcher subscribed in code, when the function on returned is called, then it stops hearing', async () => {
    let off = () => {}
    const quitter = Implementation.define('acme2/quitter', { provides: [Log], make: ctx => {
      off = ok(ctx.one(Store)).on(Store.ops.saved, ({ output }) => { heard.push(output) })
      return [provide(Log, { record: async () => success(null) })]
    } })
    const reg = registry(); reg.add(Provider.define('acme2', [quitter]))
    const { app } = await create({ pods: { w: Pod.eager(quitter), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } }, reg)
    await app.call('r', 'db').save('x'); await tick()
    off()
    await app.call('r', 'db').save('y'); await tick()
    expect(heard).toEqual(['db:x'])
  })
  // Review Focus 4.
  test('given a watcher subscribed through its call edge, when apply removes that edge, then a later emission does not reach it', async () => {
    const d = watched()
    const { app, events } = await create(d)
    ok(await app.apply({ ...d, runtimes: { r: { ...d.runtimes.r, subscriptions: [] } } }))
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual([])
    expect(sent(events, 'on')).toEqual([])
  })
  test('given a watcher subscribed through its call edge, when apply removes that edge and a later apply restores it, then the old subscription stays dropped', async () => {
    const d = watched()
    const { app, events } = await create(d)
    ok(await app.apply({ ...d, runtimes: { r: { ...d.runtimes.r, subscriptions: [] } } }))
    ok(await app.apply(d))
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual([])
    expect(sent(events, 'on')).toEqual([])
  })
  test('given a selection kept past the removal of its edge, when on is called it throws not-found, and restoring the edge brings nothing back', async () => {
    let kept: Selection<typeof Store> | undefined
    const keeper = Implementation.define('acme2/keeper', { provides: [Log], make: ctx => { kept = ok(ctx.one(Store)); return [provide(Log, { record: async () => success(null) })] } })
    const reg = registry(); reg.add(Provider.define('acme2', [keeper]))
    const d: AppDeployment = { pods: { w: Pod.eager(keeper), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } }
    const { app, events } = await create(d, reg)
    ok(await app.apply({ ...d, runtimes: { r: { ...d.runtimes.r!, subscriptions: [] } } }))
    expect(thrownBy(() => kept!.on(Store.ops.save, () => { heard.push('late') }))?.fail.type).toBe('not-found')
    ok(await app.apply(d))
    await app.call('r', 'db').save('x')
    await tick()
    expect(heard).toEqual([])
    expect(sent(events, 'on')).toEqual([])
  })
  test('given a watcher whose on callback throws, when the store saves, then it is a failure on the stream and the caller still gets its result', async () => {
    const thrower = Implementation.define('acme2/thrower', { provides: [Log], make: ctx => {
      ok(ctx.one(Store)).on(Store.ops.save, () => { throw new Error('boom') })
      return [provide(Log, { record: async () => success(null) })]
    } })
    const reg = registry(); reg.add(Provider.define('acme2', [thrower]))
    const { app, events } = await create({ pods: { w: Pod.eager(thrower), db: Pod.lazy(store, { config: 'db' }) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } }, reg)
    expect(await app.call('r', 'db').save('x')).toEqual(success('db:x'))
    await tick()
    expect(sent(events, 'on')).toEqual(['r:db->w'])
    expect(events).toContainEqual(expect.objectContaining({ type: 'failure', pod: 'w' }))
  })
  test("given a store publishing data that breaks its event's schema, when it saves, then it is a failure on the stream and no pipe or on delivers it", async () => {
    const liar = Implementation.define('acme2/liar', { provides: [Store], make: ctx => [provide(Store, { save: async s => {
      await ctx.publish(Store.ops.saved, 42 as unknown as string)   // breaks the schema on purpose
      return success(s)
    } })] })
    const reg = registry(); reg.add(Provider.define('acme2', [liar]))
    const { app, events } = await create({ pods: { w: Pod.eager(watcher), db: Pod.lazy(liar), log: Pod.lazy(logger) },
      runtimes: { r: { pods: ['w', 'db', 'log'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' },
        { kind: 'pipe', from: 'db', source: 'acme.Store/saved', to: 'log', target: 'acme.Log/record' }] } } }, reg)
    expect(await app.call('r', 'db').save('x')).toEqual(success('x'))
    await tick()
    expect([heard, logged]).toEqual([[], []])
    expect(sent(events)).toEqual(['r:host->db'])
    expect(events).toContainEqual(expect.objectContaining({ type: 'failure', pod: 'db' }))
  })
})
