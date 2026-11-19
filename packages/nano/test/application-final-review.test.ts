/** Values and a live application (spec: 2026-11-14-values-and-application-design.md); fixtures in fixtures/acme-values.ts. */
import { describe, expect, test } from 'bun:test'
import { Pod, AppDeployment, Implementation, provide, Provider, success, type Policy } from '../src/index.ts'
import { Counter, counter, state, kv, sender, db, registry, ok, create, live, one } from './fixtures/acme-values.ts'

describe('final review', () => {
  const tick = () => new Promise(r => setTimeout(r, 0))
  const wired = (): AppDeployment => ({ pods: { send: Pod.lazy(sender), db: Pod.lazy(kv) }, runtimes: { r: { pods: ['send', 'db'], subscriptions: [] } } })
  const sub = { kind: 'call', from: 'send', to: 'db' } as const

  // I1: the application keeps its own copy.
  test('given deployment() mutated in place, when applied, then the change takes effect', async () => {
    const policies: Record<string, Policy> = { r: { isAllowed: ask => (ask.kind === 'call' ? { approved: false, reason: 'frozen' } : { approved: true }) } }
    const { app } = await live(wired(), { policies })
    const d = app.deployment()
    d.runtimes.r!.subscriptions.push(sub)
    expect(await app.apply(d)).toEqual(success(undefined))
    expect(app.deployment()).toEqual(d)
  })
  test('given the object passed to create, when it is mutated, then nothing changes', async () => {
    const d = wired()
    const { app } = await live(d)
    d.runtimes.r!.subscriptions.push(sub)
    expect(await app.call('r', 'send').send('k')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(app.deployment()).toEqual(wired())
  })
  test('given deployment() mutated without apply, then routing does not change', async () => {
    const { app } = await live(wired())
    const d = app.deployment()
    d.runtimes.r!.subscriptions.push(sub)
    d.runtimes.r!.pods.pop()
    expect(await app.call('r', 'send').send('k')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.call('r', 'db').get('k')).toEqual(success(''))
  })

  // I2: names that are Object.prototype keys are only names.
  test('given a runtime toString and a pod constructor, when called, restarted and applied in and out, then all of it works', async () => {
    const d = { pods: { constructor: Pod.lazy(counter) }, runtimes: { toString: { pods: ['constructor'], subscriptions: [] } }, tags: { constructor: ['x'] } }
    const { app } = await live(d, { policies: {} })
    expect(await app.call('toString', 'constructor').inc(null)).toEqual(success(1))
    expect(await app.restart('constructor')).toEqual(success(undefined))
    expect(await app.call('toString', 'constructor').inc(null)).toEqual(success(1))
    expect(app.deployment()).toEqual(d)
    expect(await app.apply(one({ c: Pod.lazy(counter) }))).toEqual(success(undefined))
    expect(await app.call('toString', 'constructor').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.apply(d)).toEqual(success(undefined))
    expect(app.deployment()).toEqual(d)
    expect(await app.call('toString', 'constructor').inc(null)).toEqual(success(1))
  })
  test('given a pod __proto__ from JSON, when called, then it answers', async () => {
    const { app } = await live(JSON.parse(JSON.stringify({ runtimes: { r: { pods: ['__proto__'], subscriptions: [] } } }).replace('{', `{"pods":{"__proto__":${JSON.stringify(Pod.lazy(counter))}},`)))
    expect(await app.call('r', '__proto__').inc(null)).toEqual(success(1))
  })
  test('given no such names, when the host calls or restarts them, then each is not-found, never a rejection', async () => {
    const { app } = await live(one({ c: Pod.lazy(counter) }))
    expect(await app.call('constructor', 'c').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.call('r', 'constructor').inc(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(await app.restart('toString')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('given host policies without a toString entry, when runtime toString calls, then the default allows', async () => {
    const { app } = await live({ pods: { c: Pod.lazy(counter) }, runtimes: { toString: { pods: ['c'], subscriptions: [] } } }, { policies: {} })
    expect(await app.call('toString', 'c').inc(null)).toEqual(success(1))
  })

  // M1: one verdict check.
  test('given a policy returning a rejected Promise, when called, then it is denied and nothing is unhandled', async () => {
    const unhandled: unknown[] = [], note = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', note)
    try {
      const policies = { r: { isAllowed: () => Promise.reject(new Error('later')) } } as unknown as Record<string, Policy>
      const { app } = await live(wired(), { policies })
      expect(await app.call('r', 'db').get('k')).toMatchObject({ ok: false, fail: { type: 'denied', reason: 'policy gave no verdict' } })
      await tick(); await tick()
      expect(unhandled).toEqual([])
    } finally { process.off('unhandledRejection', note) }
  })
  test('given a verdict whose approved getter throws, when called, then it is denied', async () => {
    const policies = { r: { isAllowed: () => ({ get approved(): boolean { throw new Error('boom') } }) } } as unknown as Record<string, Policy>
    const { app } = await live(wired(), { policies })
    expect(await app.call('r', 'db').get('k')).toMatchObject({ ok: false, fail: { type: 'denied', reason: 'policy threw: boom' } })
  })

  // M2: a call waiting on a build uses that build's implementation.
  test('given a call waiting on a build, when apply changes the pod, then the call finishes on the old build and the next uses the new', async () => {
    let open = () => {}
    const slow = Implementation.define('acme4/slow', { provides: [Counter], make: async () => {
      await new Promise<void>(r => { open = r }); return [provide(Counter, { inc: async () => success(7) })]
    } })
    const reg = registry(); reg.add(Provider.define('acme4', [slow]))
    const app = ok(await create(one({ x: Pod.lazy(slow) }), {}, reg))
    const calling = app.call('r', 'x').inc(null)
    await tick()
    expect(await app.apply(one({ x: Pod.lazy(kv) }))).toEqual(success(undefined))
    open()
    expect(await calling).toEqual(success(7))
    expect(await app.call('r', 'x').get('k')).toEqual(success(''))
  })

  // M3.
  test('given a rewire-only apply, when an unchanged pod is called again, then it keeps its state', async () => {
    const d = { ...wired(), pods: { ...wired().pods, c: Pod.lazy(counter) }, runtimes: { r: { pods: ['send', 'db', 'c'], subscriptions: [] } } }
    const { app } = await live(d)
    expect(await app.call('r', 'c').inc(null)).toEqual(success(1))
    expect(await app.apply({ ...d, runtimes: { r: { pods: ['send', 'db', 'c'], subscriptions: [sub] } } })).toEqual(success(undefined))
    expect(await app.call('r', 'c').inc(null)).toEqual(success(2))
  })
})
