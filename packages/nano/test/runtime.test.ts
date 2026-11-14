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
const DB_GET = portKey(DB.coord, DB.ops.get.coord)

function setup(opts: { policy?: Policy; idTaken?: (id: string) => boolean } = {}) {
  const registry = createRegistry()
  for (const p of [
    provider('acme/clock', [ticker]), provider('acme/log', [memLog, noteLog]), provider('acme/db', [memDb, fileDb]),
    provider('acme/app', [app, configured]), provider('acme/bad', [boom]),
  ]) registry.add(p)
  const rt = createRuntime('r1', { registry, ...opts })
  const events: RuntimeEvent[] = []
  rt.listen(e => events.push(e))
  return { rt, events, registry }
}

const tickToLog = { kind: 'event' as const, from: 'a#0', source: TICK, to: 'b#0', target: WRITE }

describe('instance coords', () => {
  test('a coord is <pod>#<n> and parses back', () => {
    expect(instanceCoord('log', 0)).toBe('log#0')
    expect(parseInstance('log#12')).toEqual({ pod: 'log', index: 12 })
    for (const bad of ['no-hash', 'log#x', 'log#01', 'log#-1', 'a#b#c', 'acme/log/mem#b', '#0']) expect(parseInstance(bad)).toBeUndefined()
  })
})

describe('runtime pods', () => {
  test('create adds a pod and announces its instance', async () => {
    const { rt, events } = setup()
    const r = await rt.create('b', 'acme/log/mem')
    expect(r).toEqual(success({ pod: 'b', instances: ['b#0'], unsatisfied: [] }))
    expect(rt.pods()).toEqual(['b'])
    expect(rt.instances()).toEqual(['b#0'])
    expect(rt.pod('b')?.home).toBe('r1')
    expect(events).toEqual([
      { type: 'pod-created', pod: 'b', implementation: 'acme/log/mem' },
      { type: 'instance', coord: 'b#0', state: 'starting' }, { type: 'instance', coord: 'b#0', state: 'running' },
    ])
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
  test('a bad pod id or count fails invalid-input', async () => {
    const { rt } = setup()
    expect(await rt.create('a/b', 'acme/log/mem')).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(await rt.create('b', 'acme/log/mem', { count: 0 })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(await rt.create('b', 'acme/log/mem', { count: 1.5 })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(rt.pods()).toEqual([])
  })
  test('a count above 500 fails invalid-input, at create and scale', async () => {
    const { rt } = setup()
    expect(await rt.create('b', 'acme/log/mem', { count: 501 })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    await rt.create('b', 'acme/log/mem')
    expect(await rt.scale('b', 501)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(rt.pod('b')!.count).toBe(1)
  })
  test('a removal at home cascades in a runtime the pod was placed into', async () => {
    const { rt, registry } = setup()
    const r2 = createRuntime('r2', { registry })
    await r2.create('z', 'acme/log/mem')
    await rt.create('a', 'acme/clock/ticker')
    rt.add(r2.record('z')!)
    rt.subscribe({ kind: 'event', from: 'a#0', source: tickToLog.source, to: 'z#0', target: tickToLog.target })
    r2.remove('z')
    expect(rt.pods()).toEqual(['a'])
    expect(rt.subscriptions()).toEqual([])
  })
  test('scale to 0 leaves a stopped pod, and scaling back up continues from next', async () => {
    const { rt } = setup()
    await rt.create('b', 'acme/log/mem', { count: 2 })
    expect(await rt.scale('b', 0)).toEqual(success([]))
    expect(rt.pod('b')).toMatchObject({ count: 0, state: 'stopped', instances: [] })
    expect(await rt.scale('b', 1)).toEqual(success(['b#2']))
    expect(await rt.create('c', 'acme/log/mem', { count: 0 })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
  test('a cascade emits each instance stopped, then subscription-removed in subscription order, then pod-removed', async () => {
    const { rt, events } = setup()
    await rt.create('a', 'acme/clock/ticker', { count: 2 })
    await rt.create('b', 'acme/log/mem', { count: 2 })
    rt.subscribe({ ...tickToLog, to: 'b#1' }); rt.subscribe({ ...tickToLog, from: 'a#1', to: 'b#0' })
    events.length = 0
    rt.remove('b')
    expect(events.filter(e => e.type !== 'status')).toEqual([
      { type: 'instance', coord: 'b#0', state: 'stopped' }, { type: 'instance', coord: 'b#1', state: 'stopped' },
      { type: 'subscription-removed', id: 's1', reason: 'cascade' }, { type: 'subscription-removed', id: 's2', reason: 'cascade' },
      { type: 'pod-removed', pod: 'b' },
    ])
  })
  test('a guest cannot scale, remove an instance or restart; a home add and removal show in the guest', async () => {
    const { rt, registry } = setup()
    const r2 = createRuntime('r2', { registry })
    await r2.create('z', 'acme/log/mem')
    await rt.create('a', 'acme/clock/ticker')
    rt.add(r2.record('z')!)
    const denied = { ok: false, fail: { type: 'denied' } }
    expect(await rt.scale('z', 2)).toMatchObject(denied)
    expect(rt.removeInstance('z#0')).toMatchObject(denied)
    expect(await rt.restart('z#0')).toMatchObject(denied)
    const seen: RuntimeEvent[] = []
    rt.listen(e => seen.push(e))
    await r2.addInstance('z')
    expect(seen).toContainEqual({ type: 'instance', coord: 'z#1', state: 'running' })
    rt.subscribe({ ...tickToLog, to: 'z#0' })
    r2.removeInstance('z#0')
    expect(rt.subscriptions()).toEqual([])
    expect(seen).toContainEqual({ type: 'instance', coord: 'z#0', state: 'stopped' })
    expect(seen).toContainEqual({ type: 'subscription-removed', id: 's1', reason: 'cascade' })
  })
  test('restarting an instance that is starting or running fails invalid-input and makes nothing twice', async () => {
    const { rt } = setup()
    await rt.create('b', 'acme/log/mem')
    expect(await rt.restart('b#0')).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'b#0 is running' } })
  })
  test('a pod whose make throws is created, with its instance failed', async () => {
    const { rt, events } = setup()
    expect(await rt.create('x', 'acme/bad/boom')).toEqual(success({ pod: 'x', instances: ['x#0'], unsatisfied: [] }))
    expect(rt.pod('x')).toMatchObject({ state: 'failed', instances: [{ coord: 'x#0', state: 'failed', reason: expect.any(String) }] })
    expect(events.at(-1)).toEqual({ type: 'instance', coord: 'x#0', state: 'failed', reason: 'x#0: nope' })
  })
  test('config that does not fit the implementation fails invalid-input', async () => {
    const { rt } = setup()
    expect(await rt.create('c', 'acme/app/conf', { config: 'x' })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect((await rt.create('c', 'acme/app/conf', { config: 3 })).ok).toBe(true)
  })
  test('without provision, every dependency is unsatisfied as not provisioned', async () => {
    const { rt } = setup()
    expect(await rt.create('a', 'acme/app/main')).toEqual(success({ pod: 'a', instances: ['a#0'], unsatisfied: [{ role: 'store', reason: 'not provisioned' }] }))
  })
  test("an instance's target carries its pod's implementation, provider, interfaces and its tags", async () => {
    const registry = createRegistry()
    registry.add(provider('acme/log', [memLog, noteLog]))
    const rt = createRuntime('r1', { registry, tagsOf: c => new Set(c === 'b#0' ? ['cache'] : []) })
    await rt.create('b', 'acme/log/mem')
    expect(rt.target('b#0')).toEqual({
      instance: 'b#0', implementation: 'acme/log/mem', provider: 'acme/log', provides: new Set(['acme/log']), tags: new Set(['cache']),
    })
    expect(rt.target('b#1')).toBeUndefined()
  })
  test('removing a pod placed from another runtime only drops the membership', async () => {
    const { rt, registry } = setup()
    const r2 = createRuntime('r2', { registry })
    await r2.create('z', 'acme/log/mem')
    expect(rt.add(r2.record('z')!)).toEqual(success(undefined))
    expect(rt.pod('z')).toMatchObject({ home: 'r2', state: 'running' })
    expect(rt.remove('z')).toEqual(success(undefined))
    expect(rt.pods()).toEqual([])
    expect(r2.pod('z')!.state).toBe('running')
  })
  test('pods are listed in create order', async () => {
    const { rt } = setup()
    await rt.create('z', 'acme/log/mem')
    await rt.create('a', 'acme/db/mem', { count: 2 })
    expect(rt.pods()).toEqual(['z', 'a'])
    expect(rt.instances()).toEqual(['z#0', 'a#0', 'a#1'])
  })
  test('a pod id is held from the moment create is called', async () => {
    const { rt } = setup()
    const pending = rt.create('b', 'acme/log/mem')
    expect(await rt.create('b', 'acme/db/mem')).toMatchObject({ ok: false, fail: { type: 'exists' } })
    expect((await pending).ok).toBe(true)
  })
  test('a pod records the config it was created with', async () => {
    const { rt } = setup()
    await rt.create('c', 'acme/app/conf', { config: 3 })
    expect(rt.pod('c')?.config).toBe(3)
  })
  test('add fails exists when the pod id is already held', async () => {
    const { rt, registry } = setup()
    const r2 = createRuntime('r2', { registry })
    await r2.create('z', 'acme/log/mem')
    await rt.create('z', 'acme/db/mem')
    expect(rt.add(r2.record('z')!)).toMatchObject({ ok: false, fail: { type: 'exists' } })
    expect(rt.pod('z')!.implementation).toBe('acme/db/mem')
  })
  test('a runtime holds at most 500 instances of its own pods: create, addInstance and scale refuse beyond', async () => {
    const { rt } = setup()
    await rt.create('a', 'acme/log/mem', { count: 400 })
    const full = { ok: false, fail: { type: 'invalid-input', reason: expect.stringContaining('more than 500 instances') } }
    expect(await rt.create('b', 'acme/log/mem', { count: 101 })).toMatchObject(full)
    expect(await rt.create('b', 'acme/log/mem', { instances: Array.from({ length: 101 }, (_, i) => i), next: 101 })).toMatchObject(full)
    await rt.create('b', 'acme/log/mem', { count: 100 })
    expect(await rt.addInstance('b')).toMatchObject(full)
    expect(await rt.scale('b', 101)).toMatchObject(full)
    expect(await rt.scale('b', 50)).toMatchObject({ ok: true })
    expect((await rt.scale('a', 450)).ok).toBe(true)
  })
  test('removing an instance frees a runtime\'s capacity for addInstance and scale', async () => {
    const { rt } = setup()
    await rt.create('a', 'acme/log/mem', { count: 500 })
    expect(await rt.addInstance('a')).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    rt.removeInstance('a#0')
    expect(await rt.addInstance('a')).toEqual(success('a#500'))
    rt.removeInstance('a#1')
    expect((await rt.scale('a', 500)).ok).toBe(true)
  })
  test('addInstance and scale refuse once no instance index is left', async () => {
    const { rt } = setup()
    await rt.create('b', 'acme/log/mem', { instances: [], next: 999_999_999 })
    expect(await rt.scale('b', 2)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(await rt.addInstance('b')).toEqual(success('b#999999999'))
    expect(await rt.addInstance('b')).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'b: no instance index is left (the last is 999999999)' } })
  })
  test('saved instances are restored in index order', async () => {
    const { rt } = setup()
    await rt.create('b', 'acme/log/mem', { instances: [2, 0, 1], next: 3 })
    expect(rt.instances()).toEqual(['b#0', 'b#1', 'b#2'])
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
  test('an end whose instance is not running leaves it waiting', async () => {
    const { rt } = setup()
    await rt.create('a', 'acme/app/main')
    await rt.create('x', 'acme/bad/boom')
    rt.subscribe({ kind: 'call', from: 'a#0', to: 'x#0' })
    expect(rt.status('s1')).toBe('waiting')
  })
  test('an event subscription whose ops do not fit is broken', async () => {
    const { rt } = setup()
    await rt.create('a', 'acme/clock/ticker')
    await rt.create('n', 'acme/log/notes')
    rt.subscribe({ ...tickToLog, to: 'n#0', target: portKey(Notes.coord, Notes.ops.note.coord) })
    expect(rt.status('s1')).toBe('broken')
  })
  test('a call subscription to a target providing none of the consumer’s dependencies is broken', async () => {
    const { rt } = setup()
    await rt.create('a', 'acme/app/main')
    await rt.create('d', 'acme/db/mem')
    await rt.create('b', 'acme/log/mem')
    rt.subscribe({ kind: 'call', from: 'a#0', to: 'd#0' })
    rt.subscribe({ kind: 'call', from: 'a#0', to: 'b#0' })
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
    const policy: Policy = { isAllowed: (_s, dest) => (dest.startsWith('b#') ? { approved: false, reason: 'no b' } : { approved: true }) }
    const { rt, events } = setup({ policy })
    expect(rt.subscribe(tickToLog)).toEqual({ ok: false, fail: { type: 'denied', reason: 'no b' } })
    expect(rt.subscriptions()).toEqual([])
    const s = rt.subscribe({ ...tickToLog, to: 'c#0' })
    const before = structuredClone(rt.subscriptions())
    const seen = events.length
    expect(s.ok && rt.retarget(s.value.id, 'b#0')).toEqual({ ok: false, fail: { type: 'denied', reason: 'no b' } })
    expect(rt.subscriptions()).toEqual(before)
    expect(events.length).toBe(seen)
  })
  test('a denied retarget leaves the status as it was', async () => {
    let deny = false
    const { rt } = setup({ policy: { isAllowed: () => (deny ? { approved: false, reason: 'no' } : { approved: true }) } })
    await rt.create('a', 'acme/clock/ticker')
    await rt.create('b', 'acme/log/mem')
    rt.subscribe(tickToLog)
    deny = true
    expect(rt.retarget('s1', 'c#0')).toMatchObject({ ok: false, fail: { type: 'denied' } })
    expect(rt.status('s1')).toBe('live')
  })
  test('subscribe and retarget reject ends that are not instance coords', () => {
    const { rt } = setup()
    const bad = { ok: false, fail: { type: 'invalid-input' } }
    expect(rt.subscribe({ ...tickToLog, to: 'nohash' })).toMatchObject(bad)
    expect(rt.subscribe({ ...tickToLog, from: 'a#b#c' })).toMatchObject(bad)
    expect(rt.subscribe({ ...tickToLog, from: 'acme/clock/ticker#a' })).toMatchObject(bad)
    expect(rt.subscribe({ ...tickToLog, source: '' })).toMatchObject(bad)
    expect(rt.subscribe({ ...tickToLog, kind: 'stream' } as any)).toMatchObject(bad)
    rt.subscribe(tickToLog)
    expect(rt.retarget('s1', 'nohash')).toMatchObject(bad)
    expect(rt.subscriptions()).toEqual([{ id: 's1', ...tickToLog }])
  })
  test('retarget moves a subscription to a new target', async () => {
    const { rt } = setup()
    await rt.create('a', 'acme/clock/ticker')
    await rt.create('c', 'acme/log/mem')
    rt.subscribe(tickToLog)
    expect(rt.retarget('s1', 'c#0')).toEqual(success(undefined))
    expect(rt.subscriptions()[0]).toMatchObject({ to: 'c#0' })
    expect(rt.status('s1')).toBe('live')
  })
  test('removing a target deletes its subscriptions (decision 49)', async () => {
    const { rt } = setup()
    await rt.create('a', 'acme/clock/ticker')
    await rt.create('b', 'acme/log/mem')
    rt.subscribe(tickToLog)
    expect(rt.remove('b')).toEqual(success(undefined))
    expect(rt.subscriptions()).toEqual([])
    expect(rt.status('s1')).toBeUndefined()
  })
  test('removing a pod at home disposes its instances', async () => {
    const { rt } = setup()
    await rt.create('d', 'acme/db/mem')
    const host = rt.record('d')!.instances.get('d#0')!.host!
    rt.remove('d')
    expect(await host.invoke(DB_GET, 'k')).toMatchObject({ ok: false, fail: { type: 'missing-component' } })
  })
  test('swap keeps the coords: subscriptions that still fit stay live, an event subscription whose op is gone is broken', async () => {
    const { rt, events } = setup()
    await rt.create('a', 'acme/app/main')
    await rt.create('d', 'acme/db/mem')
    await rt.create('t', 'acme/clock/ticker')
    await rt.create('b', 'acme/log/mem')
    rt.subscribe({ kind: 'call', from: 'a#0', to: 'd#0' })
    rt.subscribe({ ...tickToLog, from: 't#0' })
    expect(await rt.swap('d', 'acme/db/file')).toEqual(success(undefined))
    expect(await rt.swap('b', 'acme/log/notes')).toEqual(success(undefined))
    expect(rt.pods()).toEqual(['a', 'd', 't', 'b'])
    expect(rt.pod('d')).toMatchObject({ implementation: 'acme/db/file', instances: [{ coord: 'd#0', state: 'running' }] })
    expect(rt.subscriptions().map(s => s.to)).toEqual(['d#0', 'b#0'])
    expect([rt.status('s1'), rt.status('s2')]).toEqual(['live', 'broken'])
    expect(events).toContainEqual({ type: 'pod-swapped', pod: 'd', from: 'acme/db/mem', to: 'acme/db/file' })
  })
  test('swap announces itself, not an add and a remove', async () => {
    const { rt, events } = setup()
    await rt.create('a', 'acme/app/main')
    await rt.create('d', 'acme/db/mem')
    rt.subscribe({ kind: 'call', from: 'a#0', to: 'd#0' })
    const seen = events.length
    await rt.swap('d', 'acme/db/file')
    expect(events.slice(seen)).toEqual([{ type: 'pod-swapped', pod: 'd', from: 'acme/db/mem', to: 'acme/db/file' }])
  })
  test('swap carries the config over unless a new one is given', async () => {
    const { rt } = setup()
    await rt.create('c', 'acme/app/conf', { config: 3 })
    await rt.swap('c', 'acme/app/conf')
    expect(rt.pod('c')?.config).toBe(3)
    await rt.swap('c', 'acme/app/conf', { config: 4 })
    expect(rt.pod('c')?.config).toBe(4)
  })
  test('swapping a pod placed from another runtime is denied and changes nothing', async () => {
    const { rt, registry } = setup()
    const r2 = createRuntime('r2', { registry })
    await r2.create('z', 'acme/log/mem')
    rt.add(r2.record('z')!)
    expect(await rt.swap('z', 'acme/log/notes')).toEqual({ ok: false, fail: { type: 'denied', reason: 'z: swap it at its home runtime r2' } })
    expect(rt.pod('z')!.implementation).toBe('acme/log/mem')
  })
  test('a swap whose make throws changes nothing, and the failure is on the stream', async () => {
    const { rt, events } = setup()
    await rt.create('d', 'acme/db/mem')
    events.length = 0
    expect(await rt.swap('d', 'acme/bad/boom')).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(rt.pod('d')).toMatchObject({ implementation: 'acme/db/mem', state: 'running' })
    expect(events).toEqual([{ type: 'failure', coord: 'd#0', reason: 'd#0: nope' }])
  })
  test("reorder changes a consumer's call order; a partial list fails not-found", async () => {
    const { rt } = setup()
    const A = 'a#0'
    rt.subscribe({ kind: 'call', from: A, to: 'd#0' })
    rt.subscribe({ ...tickToLog })
    rt.subscribe({ kind: 'call', from: A, to: 'e#0' })
    expect(rt.reorder(A, ['s3', 's1'])).toEqual(success(undefined))
    expect(rt.subscriptions().map(s => s.id)).toEqual(['s3', 's2', 's1'])
    expect(rt.reorder(A, ['s3'])).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(rt.subscriptions().map(s => s.id)).toEqual(['s3', 's2', 's1'])
  })
  test('a reorder the policy denies changes nothing', () => {
    let deny = false
    const { rt } = setup({ policy: { isAllowed: () => (deny ? { approved: false, reason: 'no' } : { approved: true }) } })
    const A = 'a#0'
    rt.subscribe({ kind: 'call', from: A, to: 'd#0' })
    rt.subscribe({ kind: 'call', from: A, to: 'e#0' })
    deny = true
    expect(rt.reorder(A, ['s2', 's1'])).toEqual({ ok: false, fail: { type: 'denied', reason: 'no' } })
    expect(rt.subscriptions().map(s => s.id)).toEqual(['s1', 's2'])
  })
  test('reordering a consumer with no call subscriptions to an empty list is a no-op', () => {
    const { rt } = setup()
    rt.subscribe(tickToLog)
    expect(rt.reorder('a#0', [])).toEqual(success(undefined))
    expect(rt.subscriptions().map(s => s.id)).toEqual(['s1'])
  })
  test('unsubscribe removes the subscription and announces it', async () => {
    const { rt, events } = setup()
    rt.subscribe(tickToLog)
    expect(rt.unsubscribe('s1')).toEqual(success(undefined))
    expect(rt.unsubscribe('s1')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(rt.subscriptions()).toEqual([])
    expect(rt.status('s1')).toBeUndefined()
    expect(events.at(-1)).toEqual({ type: 'subscription-removed', id: 's1', reason: 'unsubscribed' })
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
