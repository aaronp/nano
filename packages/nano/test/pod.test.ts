import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, portKey } from '../src/iface.ts'
import { failure, success } from '../src/result.ts'
import type { NanoContext } from '../src/context.ts'
import { implementation, provide } from '../src/implementation.ts'
import { createHostPod } from '../src/pod.ts'

const Str = defineSchema('Str', Type.String())
const Num = defineSchema('Num', Type.Number())
const api = iface('acme/api', { len: op.action('len', Str, Num), poke: op.sink('poke', Str) })
const ctx = { instance: 'acme/x/api#1', runtime: 'r1', config: undefined } as NanoContext // handlers here never call out
const LEN = portKey('acme/api', api.ops.len.coord)
const POKE = portKey('acme/api', api.ops.poke.coord)

const impl = (len: (c: NanoContext, s: string) => Promise<any>) =>
  implementation('acme/x/api', { provides: [api], make: () => [provide(api, { len: len as any, poke: async () => success(undefined) })] })

async function pod(len: (c: NanoContext, s: string) => any, timeoutMs?: number) {
  const seen: string[] = [] // failures reported
  const r = await createHostPod('acme/x/api#1', impl(len), ctx, { onFailure: reason => seen.push(reason), timeoutMs })
  if (!r.ok) throw new Error('pod failed')
  return { pod: r.value, seen }
}

describe('host pod', () => {
  test("a handler's success comes back as is", async () => {
    const { pod: p } = await pod(async (_c, s) => success(s.length))
    expect(await p.invoke(LEN, 'abc')).toEqual(success(3))
  })
  test('handlers receive the pod context', async () => {
    let got: NanoContext | undefined
    const { pod: p } = await pod(async c => { got = c; return success(1) })
    await p.invoke(LEN, 'a')
    expect(got).toBe(ctx)
  })
  test('an unknown port is unknown-op', async () => {
    const { pod: p } = await pod(async () => success(1))
    expect((await p.invoke('nope', 'a'))).toMatchObject({ ok: false, fail: { type: 'unknown-op' } })
  })
  test('invalid input never reaches the handler', async () => {
    let called = false
    const { pod: p } = await pod(async () => { called = true; return success(1) })
    expect(await p.invoke(LEN, 5)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(called).toBe(false)
  })
  test('a synchronous throw becomes threw and a failure', async () => {
    const { pod: p, seen } = await pod((() => { throw new Error('boom') }) as any)
    expect(await p.invoke(LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(seen).toEqual(['acme/x/api#1: boom'])
  })
  test('a rejection becomes threw and a failure', async () => {
    const { pod: p, seen } = await pod(async () => { throw new Error('boom') })
    const r = await p.invoke(LEN, 'a')
    expect(r).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(seen).toEqual(['acme/x/api#1: boom'])
  })
  test('a handler that never settles times out, and is a failure', async () => {
    const { pod: p, seen } = await pod(() => new Promise(() => {}), 20)
    expect(await p.invoke(LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'timeout' } })
    expect(seen).toEqual(['acme/x/api#1: len did not settle in 20ms'])
  })
  test('a make that never settles times out', async () => {
    const stuck = implementation('acme/x/api', { provides: [api], make: () => new Promise(() => {}) })
    expect(await createHostPod('acme/x/api#1', stuck, ctx, { timeoutMs: 20 })).toMatchObject({ ok: false, fail: { type: 'timeout' } })
  })
  test('a handler settling after the timeout adds no second failure and no rejection', async () => {
    const { pod: p, seen } = await pod(() => new Promise((_, rej) => setTimeout(() => rej(new Error('late')), 40)), 20)
    await p.invoke(LEN, 'a')
    await new Promise(r => setTimeout(r, 50))
    expect(seen).toHaveLength(1)
  })
  test('a non-NanoResult return is invalid-output', async () => {
    const { pod: p } = await pod(async () => 3)
    expect(await p.invoke(LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'invalid-output' } })
  })
  test('an ok value that breaks the output schema is invalid-output', async () => {
    const { pod: p } = await pod(async () => success('not a number'))
    expect(await p.invoke(LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'invalid-output' } })
  })
  test('a handler fail passes through unchanged', async () => {
    const { pod: p } = await pod(async () => failure('denied', 'no'))
    expect(await p.invoke(LEN, 'a')).toEqual(failure('denied', 'no'))
  })
  test('a sink ok value is not checked', async () => {
    const { pod: p } = await pod(async () => success(1))
    expect(await p.invoke(POKE, 'a')).toEqual(success(undefined))
  })
  test('make throwing fails pod creation with threw', async () => {
    const bad = implementation('acme/x/bad', { provides: [api], make: () => { throw new Error('nope') } })
    expect(await createHostPod('acme/x/bad#1', bad, ctx)).toEqual(failure('threw', 'acme/x/bad#1: nope'))
  })
  test('a disposed pod fails not-found, and is no failure', async () => {
    const { pod: p, seen } = await pod(async () => success(1))
    p.dispose()
    expect(await p.invoke(LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(seen).toEqual([])
  })
  test('a sync non-NanoResult return is invalid-output, a sync throw is threw', async () => {
    expect(await (await pod(() => undefined)).pod.invoke(LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'invalid-output' } })
    expect(await (await pod(() => 3)).pod.invoke(LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'invalid-output' } })
    expect(await (await pod(() => { throw new Error('x') })).pod.invoke(LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'threw' } })
  })
  test('a throwing observer never changes invoke results', async () => {
    const unhandled: unknown[] = []
    const h = (e: unknown) => unhandled.push(e)
    process.on('unhandledRejection', h)
    const make = async (len: (c: NanoContext, s: string) => any, timeoutMs?: number) => {
      const r = await createHostPod('acme/x/api#1', impl(len), ctx, { onFailure: () => { throw new Error('obs') }, timeoutMs })
      if (!r.ok) throw new Error('pod failed')
      return r.value
    }
    expect(await (await make(async (_c, s) => success(s.length))).invoke(LEN, 'abc')).toEqual(success(3))
    expect(await (await make(async () => { throw new Error('b') })).invoke(LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(await (await make(() => new Promise(() => {}), 20)).invoke(LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'timeout' } })
    await new Promise(r => setTimeout(r, 10))
    process.off('unhandledRejection', h)
    expect(unhandled).toEqual([])
  })
  test('a fast success leaves no pending timer', async () => {
    const t0 = performance.now()
    const { pod: p } = await pod(async () => success(1), 5_000)
    await p.invoke(LEN, 'a')
    expect(performance.now() - t0).toBeLessThan(50)
  })
})
