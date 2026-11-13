import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, portKey } from '../src/iface.ts'
import { success } from '../src/result.ts'
import { implementation, provide } from '../src/implementation.ts'
import { provider } from '../src/provider.ts'
import { createRegistry } from '../src/registry.ts'
import type { Policy } from '../src/policy.ts'
import { createRuntime, instanceCoord, parseInstance, type RuntimeEvent } from '../src/runtime/index.ts'

const Num = defineSchema('Num', Type.Number())
const Str = defineSchema('Str', Type.String())
const Ticks = iface('acme/ticks', { tick: op.source('tick', Num) })
const Log = iface('acme/log', { write: op.sink('write', Num) })
const Notes = iface('acme/notes', { note: op.sink('note', Str) })
const DB = iface('acme/db', { get: op.action('get', Str, Str) })
const TICK = portKey(Ticks.coord, Ticks.ops.tick.coord)
const WRITE = portKey(Log.coord, Log.ops.write.coord)

const ok = async () => success(undefined)
const ticker = implementation('acme/clock/ticker', { provides: [Ticks], make: () => [] })
const memLog = implementation('acme/log/mem', { provides: [Log], make: () => [provide(Log, { write: ok })] })
const noteLog = implementation('acme/log/notes', { provides: [Notes], make: () => [provide(Notes, { note: ok })] })
const memDb = implementation('acme/db/mem', { provides: [DB], make: () => [provide(DB, { get: async (_c, k) => success(k) })] })
const fileDb = implementation('acme/db/file', { provides: [DB], make: () => [provide(DB, { get: async (_c, k) => success(k) })] })
const app = implementation('acme/app/main', { provides: [], dependencies: { store: DB }, make: () => [] })
const boom = implementation('acme/bad/boom', { provides: [], make: () => { throw new Error('nope') } })
const configured = implementation('acme/app/conf', { provides: [], config: Num, make: () => [] })

function setup(opts: { policy?: Policy; idTaken?: (id: string) => boolean } = {}) {
  const registry = createRegistry()
  for (const p of [
    provider('acme/clock', [ticker]), provider('acme/log', [memLog, noteLog]), provider('acme/db', [memDb, fileDb]),
    provider('acme/app', [app, configured]), provider('acme/bad', [boom]),
  ]) registry.add(p)
  const rt = createRuntime('r1', { registry, ...opts })
  const events: RuntimeEvent[] = []
  rt.listen(e => events.push(e))
  return { rt, events }
}

const tickToLog = { kind: 'event' as const, from: 'acme/clock/ticker#a', source: TICK, to: 'acme/log/mem#b', target: WRITE }

describe('instance coords', () => {
  test('a coord is implementation#id and parses back', () => {
    expect(instanceCoord('acme/log/mem', 'b')).toBe('acme/log/mem#b')
    expect(parseInstance('acme/log/mem#b')).toEqual({ implementation: 'acme/log/mem', id: 'b' })
    expect(parseInstance('no-hash')).toBeUndefined()
  })
})

describe('runtime members', () => {
  test('create adds a member and announces it', async () => {
    const { rt, events } = setup()
    const r = await rt.create('b', 'acme/log/mem')
    expect(r).toEqual(success({ coord: 'acme/log/mem#b', unsatisfied: [] }))
    expect(rt.members()).toEqual(['acme/log/mem#b'])
    expect(rt.member('acme/log/mem#b')?.home).toBe('r1')
    expect(events).toEqual([{ type: 'instance-added', instance: 'acme/log/mem#b', home: 'r1' }])
  })
  test('an unknown implementation fails not-found', async () => {
    const { rt } = setup()
    expect(await rt.create('b', 'acme/nope/x')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('a taken id fails exists', async () => {
    const { rt } = setup({ idTaken: id => id === 'elsewhere' })
    await rt.create('b', 'acme/log/mem')
    expect(await rt.create('b', 'acme/db/mem')).toMatchObject({ ok: false, fail: { type: 'exists' } })
    expect(await rt.create('elsewhere', 'acme/db/mem')).toMatchObject({ ok: false, fail: { type: 'exists' } })
  })
  test('a pod that cannot be made fails threw and adds nothing', async () => {
    const { rt } = setup()
    expect(await rt.create('x', 'acme/bad/boom')).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(rt.members()).toEqual([])
  })
  test('config that does not fit the implementation fails invalid-input', async () => {
    const { rt } = setup()
    expect(await rt.create('c', 'acme/app/conf', { config: 'x' })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect((await rt.create('c', 'acme/app/conf', { config: 3 })).ok).toBe(true)
  })
  test('until provisioning exists, every dependency is unsatisfied', async () => {
    const { rt } = setup()
    expect(await rt.create('a', 'acme/app/main')).toEqual(success({ coord: 'acme/app/main#a', unsatisfied: [{ role: 'store', reason: 'not provisioned' }] }))
  })
  test("a member's target carries its implementation, provider, interfaces and tags", async () => {
    const registry = createRegistry()
    registry.add(provider('acme/log', [memLog, noteLog]))
    const rt = createRuntime('r1', { registry, tagsOf: () => new Set(['cache']) })
    await rt.create('b', 'acme/log/mem')
    expect(rt.target('acme/log/mem#b')).toEqual({
      instance: 'acme/log/mem#b', implementation: 'acme/log/mem', provider: 'acme/log', provides: new Set(['acme/log']), tags: new Set(['cache']),
    })
  })
  test('removing a member placed from another runtime only drops the membership', async () => {
    const { rt } = setup()
    let disposed = false
    rt.add({ coord: 'acme/log/mem#z', home: 'r2', pod: { instance: 'acme/log/mem#z', implementation: memLog, invoke: ok, dispose: () => { disposed = true } } })
    expect(rt.remove('acme/log/mem#z')).toEqual(success(undefined))
    expect(rt.members()).toEqual([])
    expect(disposed).toBe(false)
  })
  test('a throwing listener does not break the runtime', async () => {
    const { rt } = setup()
    rt.listen(() => { throw new Error('listener') })
    expect((await rt.create('b', 'acme/log/mem')).ok).toBe(true)
  })
})

describe('runtime subscriptions', () => {
  test('subscribe with both ends present is live', async () => {
    const { rt } = setup()
    await rt.create('a', 'acme/clock/ticker')
    await rt.create('b', 'acme/log/mem')
    const s = rt.subscribe(tickToLog)
    expect(s).toEqual(success({ id: 's1', ...tickToLog }))
    expect(rt.status('s1')).toBe('live')
  })
  test('with an end missing it waits, and goes live when the end is added', async () => {
    const { rt } = setup()
    await rt.create('a', 'acme/clock/ticker')
    rt.subscribe(tickToLog)
    expect(rt.status('s1')).toBe('waiting')
    await rt.create('b', 'acme/log/mem')
    expect(rt.status('s1')).toBe('live')
  })
  test('an event subscription whose ops do not fit is broken', async () => {
    const { rt } = setup()
    await rt.create('a', 'acme/clock/ticker')
    await rt.create('n', 'acme/log/notes')
    rt.subscribe({ ...tickToLog, to: 'acme/log/notes#n', target: portKey(Notes.coord, Notes.ops.note.coord) })
    expect(rt.status('s1')).toBe('broken')
  })
  test('a call subscription to a target providing none of the consumer’s dependencies is broken', async () => {
    const { rt } = setup()
    await rt.create('a', 'acme/app/main')
    await rt.create('d', 'acme/db/mem')
    await rt.create('b', 'acme/log/mem')
    rt.subscribe({ kind: 'call', from: 'acme/app/main#a', to: 'acme/db/mem#d' })
    rt.subscribe({ kind: 'call', from: 'acme/app/main#a', to: 'acme/log/mem#b' })
    expect([rt.status('s1'), rt.status('s2')]).toEqual(['live', 'broken'])
  })
  test('ids default to the first free s<n>, and a taken id fails exists', async () => {
    const { rt } = setup()
    rt.subscribe({ ...tickToLog, id: 's2' })
    expect(rt.subscribe(tickToLog)).toMatchObject({ ok: true, value: { id: 's1' } })
    expect(rt.subscribe(tickToLog)).toMatchObject({ ok: true, value: { id: 's3' } })
    expect(rt.subscribe({ ...tickToLog, id: 's1' })).toMatchObject({ ok: false, fail: { type: 'exists' } })
  })
  test('a denied subscribe or retarget changes nothing and gives the reason', async () => {
    const policy: Policy = { isAllowed: (_s, dest) => (dest.endsWith('#b') ? { approved: false, reason: 'no b' } : { approved: true }) }
    const { rt, events } = setup({ policy })
    expect(rt.subscribe(tickToLog)).toEqual({ ok: false, fail: { type: 'denied', reason: 'no b' } })
    expect(rt.subscriptions()).toEqual([])
    const s = rt.subscribe({ ...tickToLog, to: 'acme/log/mem#c' })
    const before = structuredClone(rt.subscriptions())
    const seen = events.length
    expect(s.ok && rt.retarget(s.value.id, 'acme/log/mem#b')).toEqual({ ok: false, fail: { type: 'denied', reason: 'no b' } })
    expect(rt.subscriptions()).toEqual(before)
    expect(events.length).toBe(seen)
  })
  test('retarget moves a subscription to a new target', async () => {
    const { rt } = setup()
    await rt.create('a', 'acme/clock/ticker')
    await rt.create('c', 'acme/log/mem')
    rt.subscribe(tickToLog)
    expect(rt.retarget('s1', 'acme/log/mem#c')).toEqual(success(undefined))
    expect(rt.subscriptions()[0]).toMatchObject({ to: 'acme/log/mem#c' })
    expect(rt.status('s1')).toBe('live')
  })
  test('removing a target leaves its subscriptions waiting', async () => {
    const { rt } = setup()
    await rt.create('a', 'acme/clock/ticker')
    await rt.create('b', 'acme/log/mem')
    rt.subscribe(tickToLog)
    expect(rt.remove('acme/log/mem#b')).toEqual(success(undefined))
    expect(rt.subscriptions()).toEqual([{ id: 's1', ...tickToLog }])
    expect(rt.status('s1')).toBe('waiting')
    await rt.create('b', 'acme/log/mem')
    expect(rt.status('s1')).toBe('live')
  })
  test('removing the home member disposes its pod', async () => {
    const { rt } = setup()
    await rt.create('d', 'acme/db/mem')
    const pod = rt.member('acme/db/mem#d')!.pod
    rt.remove('acme/db/mem#d')
    expect(await pod.invoke(portKey(DB.coord, DB.ops.get.coord), 'k')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('replace keeps subscriptions that still fit and marks an event subscription broken when the op is gone', async () => {
    const { rt, events } = setup()
    await rt.create('a', 'acme/app/main')
    await rt.create('d', 'acme/db/mem')
    await rt.create('t', 'acme/clock/ticker')
    await rt.create('b', 'acme/log/mem')
    rt.subscribe({ kind: 'call', from: 'acme/app/main#a', to: 'acme/db/mem#d' })
    rt.subscribe({ ...tickToLog, from: 'acme/clock/ticker#t' })
    expect(await rt.replace('acme/db/mem#d', 'acme/db/file')).toEqual(success('acme/db/file#d'))
    expect(await rt.replace('acme/log/mem#b', 'acme/log/notes')).toEqual(success('acme/log/notes#b'))
    expect(rt.members()).toEqual(['acme/app/main#a', 'acme/clock/ticker#t', 'acme/db/file#d', 'acme/log/notes#b'])
    expect(rt.subscriptions().map(s => s.to)).toEqual(['acme/db/file#d', 'acme/log/notes#b'])
    expect([rt.status('s1'), rt.status('s2')]).toEqual(['live', 'broken'])
    expect(events).toContainEqual({ type: 'instance-replaced', from: 'acme/db/mem#d', to: 'acme/db/file#d' })
  })
  test('replace announces itself and its rewritten subscriptions, not an add and a remove', async () => {
    const { rt, events } = setup()
    await rt.create('a', 'acme/app/main')
    await rt.create('d', 'acme/db/mem')
    rt.subscribe({ kind: 'call', from: 'acme/app/main#a', to: 'acme/db/mem#d' })
    const seen = events.length
    await rt.replace('acme/db/mem#d', 'acme/db/file')
    expect(events.slice(seen)).toEqual([
      { type: 'instance-replaced', from: 'acme/db/mem#d', to: 'acme/db/file#d' },
      { type: 'subscription-set', subscription: { id: 's1', kind: 'call', from: 'acme/app/main#a', to: 'acme/db/file#d' } },
    ])
  })
  test('a replace the policy denies for a rewritten subscription changes nothing', async () => {
    const policy: Policy = { isAllowed: (_s, dest) => (dest === 'acme/db/file#d' ? { approved: false, reason: 'no file' } : { approved: true }) }
    const { rt } = setup({ policy })
    await rt.create('a', 'acme/app/main')
    await rt.create('d', 'acme/db/mem')
    rt.subscribe({ kind: 'call', from: 'acme/app/main#a', to: 'acme/db/mem#d' })
    expect(await rt.replace('acme/db/mem#d', 'acme/db/file')).toEqual({ ok: false, fail: { type: 'denied', reason: 'no file' } })
    expect(rt.members()).toEqual(['acme/app/main#a', 'acme/db/mem#d'])
    expect(rt.subscriptions()[0]).toMatchObject({ to: 'acme/db/mem#d' })
  })
  test("reorder changes a consumer's call order; a partial list fails not-found", async () => {
    const { rt } = setup()
    const A = 'acme/app/main#a'
    rt.subscribe({ kind: 'call', from: A, to: 'acme/db/mem#d' })
    rt.subscribe({ ...tickToLog })
    rt.subscribe({ kind: 'call', from: A, to: 'acme/db/file#e' })
    expect(rt.reorder(A, ['s3', 's1'])).toEqual(success(undefined))
    expect(rt.subscriptions().map(s => s.id)).toEqual(['s3', 's2', 's1'])
    expect(rt.reorder(A, ['s3'])).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(rt.subscriptions().map(s => s.id)).toEqual(['s3', 's2', 's1'])
  })
  test('unsubscribe removes the subscription and announces it', async () => {
    const { rt, events } = setup()
    rt.subscribe(tickToLog)
    expect(rt.unsubscribe('s1')).toEqual(success(undefined))
    expect(rt.unsubscribe('s1')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(rt.subscriptions()).toEqual([])
    expect(rt.status('s1')).toBeUndefined()
    expect(events.at(-1)).toEqual({ type: 'subscription-removed', id: 's1' })
  })
  test('status events fire only on change', async () => {
    const { rt, events } = setup()
    await rt.create('a', 'acme/clock/ticker')
    rt.subscribe(tickToLog)
    await rt.create('x', 'acme/db/mem')
    await rt.create('b', 'acme/log/mem')
    await rt.create('y', 'acme/db/file')
    expect(events.filter(e => e.type === 'status')).toEqual([
      { type: 'status', id: 's1', status: 'waiting' },
      { type: 'status', id: 's1', status: 'live' },
    ])
  })
})
