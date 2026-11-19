/** A runtime's slice of the application and closing (specs: 2026-11-14-values-and-application-design.md, 2026-11-14-pods-runtimes-application-design.md); fixtures in fixtures/acme-closing.ts. */
import { describe, expect, test } from 'bun:test'
import { Pod, success } from '../src/index.ts'
import { log, counter, ticker, halfBuilt, messy, slowClose, slowMake, ok, live, one, wait } from './fixtures/acme-closing.ts'

describe('closing', () => {
  // Behaviour 18 and 24.
  test('given a built counter, when it is restarted, then its close listener runs with restarted before the new instance is built, and the stream shows closed', async () => {
    const { app, events } = await live(one({ c: Pod.eager(counter) }))
    await app.restart('c')
    expect(log).toEqual(['build c', 'close c restarted', 'build c'])
    expect(events).toContainEqual({ type: 'closed', pod: 'c', reason: 'restarted' })
  })
  // Behaviour 19.
  test('given built pods, when apply removes one, changes one and only rewires the rest, then only the removed and changed ones close, with their reasons', async () => {
    const d = { pods: { gone: Pod.eager(counter), changed: Pod.eager(counter, { config: 1 }), kept: Pod.eager(counter) },
      runtimes: { r: { pods: ['gone', 'changed', 'kept'], subscriptions: [] }, s: { pods: [], subscriptions: [] } } }
    const { app } = await live(d)
    log.length = 0
    ok(await app.apply({ pods: { changed: Pod.eager(counter, { config: 2 }), kept: d.pods.kept },
      runtimes: { r: { pods: ['changed', 'kept'], subscriptions: [] }, s: { pods: ['kept'], subscriptions: [] } } }))
    // The two closes may come in either order; the rebuild comes after both (see the close-before-rebuild tests).
    expect(log.at(-1)).toBe('build changed')
    expect(log.slice(0, -1).sort()).toEqual(['close changed changed', 'close gone removed'])
  })
  // Close before rebuild, for a lazy pod called while it closes.
  test('given a lazy pod with a slow close listener, when it is restarted and called meanwhile, then it closes before it is built again', async () => {
    const { app } = await live(one({ s: Pod.lazy(slowClose) }))
    ok(await app.call('r', 's').inc(null))
    const restarting = app.restart('s')
    await wait(5)
    ok(await app.call('r', 's').inc(null))
    ok(await restarting)
    expect(log).toEqual(['build s', 'close s restarted', 'build s'])
  })
  test('given a lazy pod with a slow close listener, when apply changes it and it is called meanwhile, then it closes before it is built again', async () => {
    const { app } = await live(one({ s: Pod.lazy(slowClose, { config: 1 }) }))
    ok(await app.call('r', 's').inc(null))
    const applying = app.apply(one({ s: Pod.lazy(slowClose, { config: 2 }) }))
    await wait(5)
    ok(await app.call('r', 's').inc(null))
    ok(await applying)
    expect(log).toEqual(['build s', 'close s changed', 'build s'])
  })
  // Behaviour 20.
  test('given an application with built and unbuilt pods, when it is closed, then built ones close with closed, later calls are not-found, apply and restart are refused, and closing again does nothing', async () => {
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
  test('given a factory that adds a close listener and then throws, when it is built, then the listener runs with closed', async () => {
    const { app } = await live(one({ h: Pod.lazy(halfBuilt) }))
    expect(await app.call('r', 'h').inc(null)).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(log).toEqual(['close h closed'])
  })
  // Behaviour 22.
  test('given close listeners that throw and hang, when the application closes, then each is a failure, the others still run and close resolves', async () => {
    const { app, events } = await live(one({ m: Pod.eager(messy) }), { timeoutMs: 20 })
    expect(await app.close()).toEqual(success(undefined))
    expect(log).toEqual(['close m closed'])
    expect(events.filter(e => e.type === 'failure' && e.pod === 'm')).toHaveLength(2)
  })
  test('given a slow close listener, when close is called twice, then the second resolves only once the first has closed everything', async () => {
    const { app } = await live(one({ c: Pod.eager(slowClose) }))
    const first = app.close()
    expect(await app.close()).toEqual(success(undefined))
    expect(log).toEqual(['build c', 'close c closed'])
    expect(await first).toEqual(success(undefined))
  })
  test('given an apply and a restart called before close, when the application closes, then both complete first; ones called after are refused', async () => {
    const { app } = await live(one({ a: Pod.eager(counter) }))
    const applying = app.apply(one({ a: Pod.eager(counter), b: Pod.eager(counter) }))
    const restarting = app.restart('a')
    const closing = app.close()
    expect(await applying).toEqual(success(undefined))
    expect(await restarting).toEqual(success(undefined))
    expect(await closing).toEqual(success(undefined))
    expect(log.slice(0, 4)).toEqual(['build a', 'build b', 'close a restarted', 'build a'])
    expect(log.slice(4).sort()).toEqual(['close a closed', 'close b closed'])   // instances close together, in no set order
    expect(await app.apply(app.deployment())).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'application is closed' } })
    expect(await app.restart('a')).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'application is closed' } })
  })
  test('given a lazy build under way, when the application closes, then close waits for it, no built follows closed and its handler never runs', async () => {
    const { app, events } = await live(one({ s: Pod.lazy(slowMake) }))
    const calling = app.call('r', 's').inc(null)
    await wait(5)
    await app.close(); log.push('close resolved')
    expect(await calling).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    await wait(40)
    expect(log).toEqual(['made s', 'close resolved'])
    expect(events.filter(e => e.type === 'built' || e.type === 'closed').map(e => e.type)).toEqual(['closed'])
  })
  // Behaviour 23.
  test('given a ticker started in make, when the application closes, then nothing ticks after close', async () => {
    const { app } = await live(one({ t: Pod.eager(ticker) }))
    await wait(20)
    await app.close()
    const after = log.length
    await wait(20)
    expect(after).toBeGreaterThan(0)
    expect(log.length).toBe(after)
  })
})
