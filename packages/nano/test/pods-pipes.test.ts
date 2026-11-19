/** Pods, runtimes and an application (spec: 2026-11-14-pods-runtimes-application-design.md): see fixtures/acme-store.ts. */
import { describe, expect, test } from 'bun:test'
import { Application, Pod, AppDeployment, success, type AppEvent, type Ask } from '../src/index.ts'
import { state, counter, store, logged, logger, slowLogger, heard, watcher, registry, ok, isSent, create, sent, tick } from './fixtures/acme-store.ts'

describe('pipes and emissions', () => {
  const piped = (source: string, logPod = 'log'): AppDeployment => ({
    pods: { db: Pod.lazy(store, { config: 'db' }), log: Pod.lazy(logger), slow: Pod.lazy(slowLogger) },
    runtimes: { r: { pods: ['db', 'log', 'slow'], subscriptions: [{ kind: 'pipe', from: 'db', source, to: logPod, target: 'acme.Log/record' }] } },
  })
  // Behaviour 7.
  test("given a pipe from db's save action to a logger, when the host saves, then the caller gets its result and the logger gets it as a pipe message; a failed save pipes nothing", async () => {
    const { app, events } = await create(piped('acme.Store/save'))
    expect(await app.call('r', 'db').save('x')).toEqual(success('db:x'))
    await tick()
    expect(logged).toEqual(['db:x'])
    expect(sent(events, 'pipe')).toEqual(['r:db->log'])
    expect(await app.call('r', 'db').save('bad')).toMatchObject({ ok: false })
    await tick()
    expect(logged).toEqual(['db:x'])
  })
  // Behaviour 8.
  test('given a pipe from an event in each of two runtimes, when the pod publishes, then each pipe delivers once, recorded in its runtime', async () => {
    const pipe = { kind: 'pipe', from: 'db', source: 'acme.Store/saved', to: 'log', target: 'acme.Log/record' }
    const { app, events } = await create({ pods: { db: Pod.lazy(store, { config: 'db' }), log: Pod.lazy(logger) },
      runtimes: { a: { pods: ['db', 'log'], subscriptions: [pipe] }, b: { pods: ['db', 'log'], subscriptions: [pipe] } } })
    await app.call('a', 'db').save('x')
    await tick()
    expect(logged).toEqual(['db:x', 'db:x'])
    expect(sent(events, 'pipe')).toEqual(['a:db->log', 'b:db->log'])
  })
  // Behaviour 11.
  test('given a slow pipe target, when the host saves, then the caller does not wait for it', async () => {
    const { app } = await create(piped('acme.Store/save', 'slow'))
    expect(await app.call('r', 'db').save('x')).toEqual(success('db:x'))
    await tick()   // the slow target is now waiting (its handler has started)
    expect(logged).toEqual([])
    state.slowOpen(); await tick()
    expect(logged).toEqual(['db:x'])
  })
  // Review Focus 5.
  test('given a pipe delivery in flight, when the application closes, then the delivery settles and the emission of its result is not delivered', async () => {
    const d = piped('acme.Store/save', 'slow')
    d.pods.c = Pod.lazy(counter)
    d.runtimes.r!.pods.push('c')
    d.runtimes.r!.subscriptions.push({ kind: 'pipe', from: 'slow', source: 'acme.Log/record', to: 'c', target: 'acme.Counter/inc' })
    const { app, events } = await create(d)
    expect(await app.call('r', 'db').save('x')).toEqual(success('db:x'))
    for (let i = 0; i < 5; i++) await tick()
    const pipe = events.filter(isSent).find(e => e.kind === 'pipe')!
    // The delivery finishes only after every pod has closed, so close() resolves after it only if it waits for it.
    const order: string[] = []
    app.listen(e => {
      if (e.type === 'closed' && e.pod === 'slow') setTimeout(() => state.slowOpen(), 5)
      if (e.type === 'delivered' && e.id === pipe.id) order.push('delivered')
    })
    expect(await app.close().then(r => { order.push('closed'); return r })).toEqual(success(undefined))
    expect(order).toEqual(['delivered', 'closed'])
    expect(logged).toEqual(['db:x'])
    expect(events).toContainEqual(expect.objectContaining({ type: 'delivered', id: pipe.id, result: success(null) }))
    expect(sent(events)).toEqual(['r:host->db', 'r:db->slow'])
  })
})

describe('policed emissions', () => {
  /** db piped to log and watched by w, in runtime r, whose policy refuses anything from db to `refused`. */
  const policed = async (refused: string) => {
    logged.length = 0; heard.length = 0
    const d: AppDeployment = { pods: { w: Pod.eager(watcher), db: Pod.lazy(store, { config: 'db' }), log: Pod.lazy(logger) },
      runtimes: { r: { pods: ['w', 'db', 'log'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' },
        { kind: 'pipe', from: 'db', source: 'acme.Store/save', to: 'log', target: 'acme.Log/record' }] } } }
    const policies = { r: { isAllowed: (ask: Ask) => ask.from === 'db' && ask.to === refused ? { approved: false as const, reason: 'no' } : { approved: true as const } } }
    const app = ok(await Application.create(ok(AppDeployment.assemble(d, registry())), { policies }))
    const events: AppEvent[] = []
    app.listen(e => events.push(e))
    return { app, events }
  }
  test('given a policy refusing db→log, when the host saves, then the pipe delivery is denied and the caller still gets its result', async () => {
    const { app, events } = await policed('log')
    expect(await app.call('r', 'db').save('x')).toEqual(success('db:x'))
    await tick()
    expect(logged).toEqual([])
    const pipe = events.filter(isSent).find(e => e.kind === 'pipe')!
    expect(events).toContainEqual({ type: 'denied', id: pipe.id, reason: 'no' })
    expect(heard).toEqual(['db:x'])
  })
  test('given a policy refusing db→w, when the host saves, then the on delivery is denied and the caller still gets its result', async () => {
    const { app, events } = await policed('w')
    expect(await app.call('r', 'db').save('x')).toEqual(success('db:x'))
    await tick()
    expect(heard).toEqual([])
    const on = events.filter(isSent).find(e => e.kind === 'on')!
    expect(events).toContainEqual({ type: 'denied', id: on.id, reason: 'no' })
    expect(logged).toEqual(['db:x'])
  })
})
