import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, portKey } from '../src/iface.ts'
import { failure, success } from '../src/result.ts'
import type { NanoContext } from '../src/context.ts'
import { implementation, provide } from '../src/implementation.ts'
import { createHostPod, type Observation } from '../src/pod.ts'

const Str = defineSchema('Str', Type.String())
const Num = defineSchema('Num', Type.Number())
const api = iface('acme/api', { len: op.action('len', Str, Num), poke: op.sink('poke', Str) })
const ctx: NanoContext = { instance: 'acme/x/api#1', runtime: 'r1', config: undefined }
const LEN = portKey('acme/api', api.ops.len.coord)
const POKE = portKey('acme/api', api.ops.poke.coord)

const impl = (len: (c: NanoContext, s: string) => Promise<any>) =>
  implementation('acme/x/api', { provides: [api], make: () => [provide(api, { len: len as any, poke: async () => success(undefined) })] })

async function pod(len: (c: NanoContext, s: string) => Promise<any>, timeoutMs?: number) {
  const seen: Observation[] = []
  const r = await createHostPod('acme/x/api#1', impl(len), ctx, { observe: o => seen.push(o), ...(timeoutMs && { timeoutMs }) })
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
  test('a synchronous throw becomes threw and an exception observation', async () => {
    const { pod: p, seen } = await pod((() => { throw new Error('boom') }) as any)
    expect(await p.invoke(LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(seen.map(o => o.kind)).toEqual(['exception', 'message'])
  })
  test('a rejection becomes threw and an exception observation', async () => {
    const { pod: p, seen } = await pod(async () => { throw new Error('boom') })
    const r = await p.invoke(LEN, 'a')
    expect(r).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(seen[0]).toMatchObject({ kind: 'exception', error: 'boom' })
  })
  test('a handler that never settles times out', async () => {
    const { pod: p } = await pod(() => new Promise(() => {}), 20)
    expect(await p.invoke(LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'timeout' } })
  })
  test('a handler settling after the timeout adds no observation and no rejection', async () => {
    const { pod: p, seen } = await pod(() => new Promise((_, rej) => setTimeout(() => rej(new Error('late')), 40)), 20)
    await p.invoke(LEN, 'a')
    await new Promise(r => setTimeout(r, 50))
    expect(seen.map(o => o.kind)).toEqual(['message'])
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
  test('every invoke is observed once', async () => {
    const { pod: p, seen } = await pod(async (_c, s) => success(s.length))
    await p.invoke(LEN, 'abc')
    await p.invoke(LEN, 9)
    expect(seen).toHaveLength(2)
    expect(seen[0]).toMatchObject({ kind: 'message', instance: 'acme/x/api#1', op: LEN, input: 'abc', result: success(3) })
  })
  test('a disposed pod fails not-found', async () => {
    const { pod: p } = await pod(async () => success(1))
    p.dispose()
    expect(await p.invoke(LEN, 'a')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
})
