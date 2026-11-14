import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, portKey } from '../src/iface.ts'
import { failure, success } from '../src/result.ts'
import type { NanoContext } from '../src/context.ts'
import { implementation, provide } from '../src/implementation.ts'
import { Pod, type PodState } from '../src/pod.ts'

const Str = defineSchema('Str', Type.String())
const Num = defineSchema('Num', Type.Number())
const api = iface('acme/api', { len: op.action('len', Str, Num), poke: op.sink('poke', Str) })
const ctx = { runtime: 't', instance: 'x#0' } as NanoContext // handlers here never call out
const LEN = portKey('acme/api', api.ops.len.coord)
const POKE = portKey('acme/api', api.ops.poke.coord)
const settle = () => new Promise(r => setTimeout(r, 0))

const impl = (len: (c: NanoContext, s: string) => Promise<any>) =>
  implementation('acme/x/api', { provides: [api], make: () => [provide(api, { len: len as any, poke: async () => success(undefined) })] })
const pod = (len: (c: NanoContext, s: string) => any, timeoutMs?: number) => Pod.create(impl(len), { timeoutMs })
/** Answers len with the config it was made from; its make takes `ms` when config says so. */
const configured = implementation('acme/x/conf', { provides: [api], make: async (config: { n: number; ms?: number }) => {
  if (config.ms) await new Promise(r => setTimeout(r, config.ms))
  return [provide(api, { len: async () => success(config.n), poke: async () => success(undefined) })]
} })

describe('pod', () => {
  test("a handler's success comes back as is, and the handler receives the ctx it was invoked with", async () => {
    let got: NanoContext | undefined
    const p = pod(async (c, s) => { got = c; return success(s.length) })
    expect(await p.invoke(ctx, LEN, 'abc')).toEqual(success(3))
    expect(got).toBe(ctx)
  })
  test('call is typed sugar for invoke, by op name', async () => {
    expect(await pod(async (_c, s) => success(s.length)).call.len!(ctx, 'ab')).toEqual(success(2))
  })
  test('call works for op names on Object.prototype, and is ambiguous for a name two interfaces share', async () => {
    const odd = iface('acme/odd', { toString: op.action('toString', Str, Str), len: op.action('len', Str, Num) })
    const both = implementation('acme/x/both', { provides: [api, odd], make: () => [
      provide(api, { len: async () => success(1), poke: async () => success(undefined) }),
      provide(odd, { toString: async () => success('s'), len: async () => success(2) }),
    ] })
    const p = Pod.create(both)
    expect(await p.call['toString' as string]!(ctx, 'x')).toEqual(success('s'))
    expect(await p.call.len!(ctx, 'x')).toMatchObject({ ok: false, fail: { type: 'ambiguous' } })
    expect(await p.invoke(ctx, portKey('acme/odd', odd.ops.len.coord), 'x')).toEqual(success(2))
  })
  test('an unknown port is unknown-op', async () => {
    expect(await pod(async () => success(1)).invoke(ctx, 'nope', 'a')).toMatchObject({ ok: false, fail: { type: 'unknown-op' } })
  })
  test('invalid input never reaches the handler', async () => {
    let called = false
    const p = pod(async () => { called = true; return success(1) })
    expect(await p.invoke(ctx, LEN, 5)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(called).toBe(false)
  })
  test('a synchronous throw or a rejection becomes threw, with the reason', async () => {
    expect(await pod((() => { throw new Error('boom') }) as any).invoke(ctx, LEN, 'a')).toEqual(failure('threw', 'acme/x/api: boom'))
    expect(await pod(async () => { throw new Error('boom') }).invoke(ctx, LEN, 'a')).toEqual(failure('threw', 'acme/x/api: boom'))
  })
  test('a handler that never settles times out', async () => {
    expect(await pod(() => new Promise(() => {}), 20).invoke(ctx, LEN, 'a')).toEqual(failure('timeout', 'acme/x/api: len did not settle in 20ms'))
  })
  test('a handler settling after the timeout is ignored: no rejection escapes', async () => {
    const unhandled: unknown[] = []
    const h = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', h)
    const p = pod(() => new Promise((_, rej) => setTimeout(() => rej(new Error('late')), 40)), 20)
    expect(await p.invoke(ctx, LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'timeout' } })
    await new Promise(r => setTimeout(r, 50))
    process.off('unhandledRejection', h)
    expect(unhandled).toEqual([])
  })
  test('a non-NanoResult return, or an ok value breaking the output schema, is invalid-output', async () => {
    for (const len of [async () => 3, () => undefined, async () => success('not a number')])
      expect(await pod(len).invoke(ctx, LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'invalid-output' } })
  })
  test('a handler fail passes through unchanged; a sink ok value is not checked', async () => {
    expect(await pod(async () => failure('denied', 'no')).invoke(ctx, LEN, 'a')).toEqual(failure('denied', 'no'))
    expect(await pod(async () => success(1)).invoke(ctx, POKE, 'a')).toEqual(success(undefined))
  })
  test('a fast success leaves no pending timer', async () => {
    const t0 = performance.now()
    await pod(async () => success(1), 5_000).invoke(ctx, LEN, 'a')
    expect(performance.now() - t0).toBeLessThan(50)
  })
})

describe('pod lifecycle', () => {
  test('it is starting at once and running once the make settles, made from its config', async () => {
    const p = Pod.create(configured, { config: { n: 7 } })
    expect([p.implementation, p.state, p.config]).toEqual(['acme/x/conf', 'starting', { n: 7 }])
    await settle()
    expect(p.state).toBe('running')
    expect(await p.invoke(ctx, LEN, 'a')).toEqual(success(7))
  })
  test('an invoke before the make settles waits for it', async () => {
    expect(await Pod.create(configured, { config: { n: 1, ms: 20 } }).invoke(ctx, LEN, 'a')).toEqual(success(1))
  })
  test('a make that throws or never settles leaves it failed; calls fail missing-component with the reason', async () => {
    const bad = Pod.create(implementation('acme/x/bad', { provides: [api], make: () => { throw new Error('nope') } }))
    await settle()
    expect(bad.state).toBe('failed')
    expect(await bad.invoke(ctx, LEN, 'a')).toEqual(failure('missing-component', 'acme/x/bad: nope'))
    const stuck = Pod.create(implementation('acme/x/stuck', { provides: [api], make: () => new Promise(() => {}) }), { timeoutMs: 20 })
    expect(await stuck.invoke(ctx, LEN, 'a')).toEqual(failure('missing-component', 'acme/x/stuck: make did not settle in 20ms'))
    expect(stuck.state).toBe('failed')
  })
  test('joining names the runtimes; leaving removes one; changed hears the make settle', async () => {
    const heard: PodState[] = []
    const p = Pod.create(configured, { config: { n: 1 } })
    const leaveA = p.join('a', s => heard.push(s))
    p.join('b', () => {})
    expect(p.runtimes).toEqual(['a', 'b'])
    leaveA()
    expect(p.runtimes).toEqual(['b'])
    const q = Pod.create(configured, { config: { n: 1 } })
    q.join('a', s => heard.push(s))
    await settle()
    expect(heard).toEqual(['running'])
  })
  test('of two overlapping swaps the last asked wins; the earlier fails invalid-input', async () => {
    const p = Pod.create(configured, { config: { n: 0 } })
    const first = p.swap({ config: { n: 1, ms: 20 } }), second = p.swap({ config: { n: 2, ms: 10 } })
    expect(await first).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(await second).toEqual(success(undefined))
    expect(p.config).toEqual({ n: 2, ms: 10 })
    expect(await p.invoke(ctx, LEN, 'a')).toEqual(success(2))
  })
  test('a call already inside the old instance finishes there; the next reaches the new one', async () => {
    let open = () => {}
    const gated = implementation('acme/x/gated', { provides: [api], make: (config: string) => [provide(api, {
      len: async () => { if (config === 'old') await new Promise<void>(r => { open = r }); return success(config.length) },
      poke: async () => success(undefined),
    })] })
    const p = Pod.create(gated, { config: 'old' })
    const inFlight = p.invoke(ctx, LEN, 'a')
    await settle()
    expect(await p.swap({ config: 'newer' })).toEqual(success(undefined))
    expect(await p.invoke(ctx, LEN, 'a')).toEqual(success(5))
    open()
    expect(await inFlight).toEqual(success(3))
  })
  test('a swap whose make fails leaves a running pod on its old instance, running', async () => {
    const p = Pod.create(configured, { config: { n: 1 } })
    await settle()
    expect(await p.swap({ config: null })).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect([p.state, p.config]).toEqual(['running', { n: 1 }])
    expect(await p.invoke(ctx, LEN, 'a')).toEqual(success(1))
  })
  test('a failed pod stays failed after a failing swap, with the new reason, and runs after a working one', async () => {
    const reasons: (string | undefined)[] = []
    const p = Pod.create(configured, { config: null })
    await settle()
    p.join('a', (_s, why) => reasons.push(why))
    expect(p.state).toBe('failed')
    expect(await p.swap({ config: undefined })).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(p.state).toBe('failed')
    expect(reasons).toHaveLength(1)
    expect(await p.swap({ config: { n: 3 } })).toEqual(success(undefined))
    expect(p.state).toBe('running')
    expect(await p.invoke(ctx, LEN, 'a')).toEqual(success(3))
  })
  test('a swap asked during the first make does not hide that it is running while the first instance serves', async () => {
    const p = Pod.create(configured, { config: { n: 1, ms: 5 } })
    const swapped = p.swap({ config: { n: 2, ms: 40 } })
    await new Promise(r => setTimeout(r, 20))
    expect(p.state).toBe('running')
    expect(await p.invoke(ctx, LEN, 'a')).toEqual(success(1))
    expect(await swapped).toEqual(success(undefined))
    expect(await p.invoke(ctx, LEN, 'a')).toEqual(success(2))
  })
  test('a disposed pod is stopped, says so, and fails calls and swaps', async () => {
    const heard: PodState[] = []
    const p = Pod.create(configured, { config: { n: 1 } })
    await settle()
    p.join('a', s => heard.push(s))
    await p.dispose()
    expect(p.state).toBe('stopped')
    expect(heard).toEqual(['stopped'])
    expect(await p.invoke(ctx, LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'missing-component' } })
    expect(await p.swap({ config: { n: 2 } })).toMatchObject({ ok: false })
  })
  // Ported from the old runtime's create: "config that does not fit the implementation fails invalid-input".
  const sized = implementation('acme/x/sized', { provides: [api], config: Num, make: (n: number) => [provide(api, { len: async () => success(n), poke: async () => success(undefined) })] })
  test('a config that does not fit the implementation leaves the pod failed, and calls fail invalid-input', async () => {
    const p = Pod.create(sized, { config: 'x' })
    await settle()
    expect(p.state).toBe('failed')
    expect(await p.invoke(ctx, LEN, 'a')).toEqual(failure('invalid-input', 'acme/x/sized: config does not fit Num'))
    expect(await p.swap({ config: 3 })).toEqual(success(undefined))
    expect(await p.invoke(ctx, LEN, 'a')).toEqual(success(3))
  })
  test('a swap to a config that does not fit fails invalid-input and changes nothing', async () => {
    const heard: PodState[] = []
    const p = Pod.create(sized, { config: 1 })
    await settle()
    p.join('a', s => heard.push(s))
    expect(await p.swap({ config: 'x' })).toEqual(failure('invalid-input', 'acme/x/sized: config does not fit Num'))
    expect([p.state, p.config, heard]).toEqual(['running', 1, []])
    expect(await p.invoke(ctx, LEN, 'a')).toEqual(success(1))
  })
})
