import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, portKey } from '../src/iface.ts'
import { success, type NanoResult } from '../src/result.ts'
import { implementation, provide, type Implementation } from '../src/implementation.ts'
import { provider } from '../src/provider.ts'
import { createRegistry } from '../src/registry.ts'
import type { Policy } from '../src/policy.ts'
import { Pod } from '../src/pod.ts'
import { createRuntime, instanceCoord, parseInstance, type Runtime, type RuntimeEvent } from '../src/runtime/index.ts'

const Num = defineSchema('Num', Type.Number())
const Str = defineSchema('Str', Type.String())
const Ticks = iface('acme/ticks', { tick: op.source('tick', Num) })
const Go = iface('acme/go', { go: op.action('go', Num, Num) })
const Log = iface('acme/log', { write: op.sink('write', Num) })
const Notes = iface('acme/notes', { note: op.sink('note', Str) })
const DB = iface('acme/db', { get: op.action('get', Str, Str) })
const Vault = iface('acme/vault', { ping: op.action('ping', Str, Str) })
const TICK = portKey(Ticks.coord, Ticks.ops.tick.coord)
const WRITE = portKey(Log.coord, Log.ops.write.coord)

const ok = async () => success(undefined)
// `go(n)` publishes tick n.
const ticker = implementation('acme/clock/ticker', { provides: [Ticks, Go], make: () => [provide(Go, { go: async (ctx, n) => { await ctx.publish(Ticks.ops.tick, n); return success(n) } })] })
const memLog = implementation('acme/log/mem', { provides: [Log], make: () => [provide(Log, { write: ok })] })
const noteLog = implementation('acme/log/notes', { provides: [Notes], make: () => [provide(Notes, { note: ok })] })
const memDb = implementation('acme/db/mem', { provides: [DB], make: () => [provide(DB, { get: async (_c, k) => success(k) })] })
const fileDb = implementation('acme/db/file', { provides: [DB], make: () => [provide(DB, { get: async (_c, k) => success(k) })] })
const app = implementation('acme/app/main', { provides: [], dependencies: { store: DB }, make: () => [] })
const boom = implementation('acme/bad/boom', { provides: [DB], make: () => { throw new Error('nope') } })
// Holds every ping until the test opens the gate: a call in flight.
let openGate = () => {}
const vault = implementation('acme/keys/vault', { provides: [Vault], make: () => [provide(Vault, { ping: async (_c, s) => {
  await new Promise<void>(r => { openGate = r })
  return success(s)
} })] })

const registry = () => {
  const r = createRegistry()
  for (const p of [
    provider('acme/clock', [ticker]), provider('acme/log', [memLog, noteLog]), provider('acme/db', [memDb, fileDb]),
    provider('acme/app', [app]), provider('acme/bad', [boom]), provider('acme/keys', [vault]),
  ]) r.add(p)
  return r
}
function setup(opts: { policy?: Policy; id?: string; tagsOf?: (c: string) => ReadonlySet<string>; next?: Record<string, number> } = {}) {
  const rt = createRuntime(opts.id ?? 'r1', { registry: registry(), ...opts })
  const events: RuntimeEvent[] = []
  rt.listen(e => events.push(e))
  /** Register a new pod of `impl`; its coord. */
  const add = (impl: Implementation, config?: unknown) => must(rt.register(Pod.create(impl, { config })))
  return { rt, events, add }
}
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const settle = () => new Promise(r => setTimeout(r, 0))

const T = 'acme/clock/ticker#0', L = 'acme/log/mem#0', M = 'acme/app/main#0', D = 'acme/db/mem#0'
const tickToLog = { kind: 'event' as const, from: T, source: TICK, to: L, target: WRITE }

describe('coords', () => {
  test('a coord is <implementation>#<n> and parses back', () => {
    expect(instanceCoord('acme/log/mem', 0)).toBe(L)
    expect(parseInstance('acme/log/mem#12')).toEqual({ implementation: 'acme/log/mem', index: 12 })
    for (const bad of ['no-hash', 'log#0', 'acme/log/mem#x', 'acme/log/mem#01', 'acme/log/mem#-1', 'a#b#c', '#0']) expect(parseInstance(bad)).toBeUndefined()
  })
})

describe('registering', () => {
  test('register gives the next coord and announces the pod and its state', async () => {
    const { rt, events } = setup()
    expect(rt.register(Pod.create(memLog))).toEqual(success(L))
    await settle()
    expect(rt.pods()).toEqual([L])
    expect(events).toEqual([
      { type: 'pod-created', coord: L, implementation: 'acme/log/mem' },
      { type: 'pod-state', coord: L, state: 'starting' }, { type: 'pod-state', coord: L, state: 'running' },
    ])
  })
  test('a given coord is used, and the counter moves past it; a coord of another implementation or a taken one fails', () => {
    const { rt } = setup()
    expect(rt.register(Pod.create(memLog), 'acme/log/mem#5')).toEqual(success('acme/log/mem#5'))
    expect(rt.next()).toEqual({ 'acme/log/mem': 6 })
    expect(rt.register(Pod.create(memLog))).toEqual(success('acme/log/mem#6'))
    expect(rt.register(Pod.create(memLog), 'acme/db/mem#0')).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(rt.register(Pod.create(memLog), 'acme/log/mem#5')).toMatchObject({ ok: false, fail: { type: 'exists' } })
    expect(rt.pods()).toEqual(['acme/log/mem#5', 'acme/log/mem#6'])
  })
  test('saved counters are restored: the next coord continues from them', () => {
    const { rt } = setup({ next: { 'acme/log/mem': 3 } })
    expect(rt.register(Pod.create(memLog))).toEqual(success('acme/log/mem#3'))
  })
  test('an implementation the registry does not know fails not-found', () => {
    const { rt } = setup()
    const other = implementation('acme/x/y', { provides: [], make: () => [] })
    expect(rt.register(Pod.create(other))).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  // Review Focus 1.
  test('registering the same pod twice in one runtime fails exists, naming its coord', () => {
    const { rt } = setup()
    const pod = Pod.create(vault)
    rt.register(pod)
    expect(rt.register(pod)).toMatchObject({ ok: false, fail: { type: 'exists', reason: expect.stringContaining('already here as acme/keys/vault#0') } })
    expect(rt.pods()).toEqual(['acme/keys/vault#0'])
  })
  test('pod(coord) is the registered pod; pods() is register order', () => {
    const { rt } = setup()
    const a = Pod.create(memLog), b = Pod.create(memDb)
    rt.register(b); rt.register(a)
    expect(rt.pod(L)).toBe(a)
    expect(rt.pod('acme/log/mem#1')).toBeUndefined()
    expect(rt.pods()).toEqual([D, L])
  })
  // Review Focus 2.
  test('a pod unregistered while a call through the runtime is in flight: the call finishes, the next is not-found', async () => {
    const { rt, add } = setup()
    const v = add(vault)
    const call = rt.call(v).ping('x')
    await settle()
    expect(rt.unregister(v)).toEqual(success(undefined))
    openGate()
    expect(await call).toEqual(success('x'))
    expect(await rt.call(v).ping('y')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('a host call is from host, on the stream and in the policy', async () => {
    const seen: string[] = []
    const { rt, events, add } = setup({ policy: { isAllowed: from => { seen.push(from); return { approved: true } } } })
    const d = add(memDb)
    expect(await rt.call(d).get('k')).toEqual(success('k'))
    expect(seen).toEqual(['host'])
    expect(events).toContainEqual(expect.objectContaining({ type: 'sent', from: 'host', to: d, kind: 'call' }))
  })
  test('a throwing listener does not break the runtime', () => {
    const { rt } = setup()
    rt.listen(() => { throw new Error('listener') })
    expect(rt.register(Pod.create(memLog)).ok).toBe(true)
  })
})

describe('a pod in two runtimes', () => {
  // Review Focus 3.
  test('disposed: pod-state stopped on both streams, their subscriptions wait, calls are missing-component', async () => {
    const a = setup({ id: 'a' }), b = setup({ id: 'b' })
    const pod = Pod.create(memDb)
    const inA = must(a.rt.register(pod)), inB = must(b.rt.register(pod))
    const sa = must(a.rt.subscribe({ kind: 'call', from: a.add(app), to: inA })), sb = must(b.rt.subscribe({ kind: 'call', from: b.add(app), to: inB }))
    await settle()
    expect([a.rt.status(sa.id), b.rt.status(sb.id)]).toEqual(['live', 'live'])
    await pod.dispose()
    for (const [x, c] of [[a, inA], [b, inB]] as const) expect(x.events).toContainEqual({ type: 'pod-state', coord: c, state: 'stopped' })
    expect([a.rt.status(sa.id), b.rt.status(sb.id)]).toEqual(['waiting', 'waiting'])
    expect(await a.rt.call(inA).get('k')).toMatchObject({ ok: false, fail: { type: 'missing-component' } })
    expect(await b.rt.call(inB).get('k')).toMatchObject({ ok: false, fail: { type: 'missing-component' } })
  })
  // Review Focus 5.
  test('a publish reaches a sink subscribed in both once per subscription, each on its own stream', async () => {
    const a = setup({ id: 'a' }), b = setup({ id: 'b' })
    const source = Pod.create(ticker), sink = Pod.create(memLog)
    for (const x of [a, b]) {
      x.rt.register(source); x.rt.register(sink)
      x.rt.subscribe(tickToLog)
    }
    expect(await a.rt.call(T).go(7)).toEqual(success(7))
    for (const x of [a, b]) {
      const sent = x.events.filter(e => e.type === 'sent' && e.kind === 'event')
      expect(sent).toEqual([expect.objectContaining({ from: T, to: L, port: WRITE })])
      expect(x.events).toContainEqual(expect.objectContaining({ type: 'delivered', id: (sent[0] as { id: string }).id, result: success(undefined) }))
      expect(x.rt.books('s1')).toEqual({ calls: 1, last: success(undefined) })
    }
  })
  test('a swap is pod-swapped on the stream of every runtime it is in', async () => {
    const a = setup({ id: 'a' }), b = setup({ id: 'b' })
    const pod = Pod.create(memDb)
    a.rt.register(pod); b.rt.register(pod)
    await settle()
    await pod.swap({ config: 1 })
    for (const x of [a, b]) expect(x.events.at(-1)).toEqual({ type: 'pod-swapped', coord: D })
  })
})

describe('subscriptions', () => {
  test('subscribe with both ends registered is live', () => {
    const { rt, add } = setup()
    add(ticker); add(memLog)
    expect(rt.subscribe(tickToLog)).toEqual(success({ id: 's1', ...tickToLog }))
    expect(rt.status('s1')).toBe('live')
  })
  test('with an end not registered it waits, and goes live when the end is registered', () => {
    const { rt, add } = setup()
    add(ticker)
    rt.subscribe(tickToLog)
    expect(rt.status('s1')).toBe('waiting')
    add(memLog)
    expect(rt.status('s1')).toBe('live')
  })
  test('an end whose pod failed to make leaves it waiting', async () => {
    const { rt, add } = setup()
    rt.subscribe({ kind: 'call', from: add(app), to: add(boom) })
    expect(rt.status('s1')).toBe('live') // starting counts as available
    await settle()
    expect(rt.status('s1')).toBe('waiting')
  })
  test('an event subscription whose ops do not fit is broken', () => {
    const { rt, add } = setup()
    add(ticker)
    rt.subscribe({ ...tickToLog, to: add(noteLog), target: portKey(Notes.coord, Notes.ops.note.coord) })
    expect(rt.status('s1')).toBe('broken')
  })
  test('a call subscription to a target providing none of the consumer’s dependencies is broken', () => {
    const { rt, add } = setup()
    const m = add(app)
    rt.subscribe({ kind: 'call', from: m, to: add(memDb) })
    rt.subscribe({ kind: 'call', from: m, to: add(memLog) })
    expect([rt.status('s1'), rt.status('s2')]).toEqual(['live', 'broken'])
  })
  test('ids default to the first free s<n>, and a taken id fails exists', () => {
    const { rt } = setup()
    rt.subscribe({ ...tickToLog, id: 's2' })
    expect(rt.subscribe(tickToLog)).toMatchObject({ ok: true, value: { id: 's1' } })
    expect(rt.subscribe(tickToLog)).toMatchObject({ ok: true, value: { id: 's3' } })
    expect(rt.subscribe({ ...tickToLog, id: 's1' })).toMatchObject({ ok: false, fail: { type: 'exists' } })
  })
  test('a coord unregistered here is deleted: subscribing to it fails not-found; a coord not yet given still waits', () => {
    const { rt, add } = setup()
    add(ticker)
    rt.unregister(add(memLog))
    expect(rt.subscribe(tickToLog)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(rt.subscribe({ ...tickToLog, to: 'acme/log/mem#1' }).ok).toBe(true)
    expect(rt.status('s1')).toBe('waiting')
  })
  test('a denied subscribe or retarget changes nothing and gives the reason', () => {
    const policy: Policy = { isAllowed: (_s, dest) => (dest === L ? { approved: false, reason: 'no log' } : { approved: true }) }
    const { rt, events } = setup({ policy })
    expect(rt.subscribe(tickToLog)).toEqual({ ok: false, fail: { type: 'denied', reason: 'no log' } })
    expect(rt.subscriptions()).toEqual([])
    const s = must(rt.subscribe({ ...tickToLog, to: 'acme/log/mem#1' }))
    const before = structuredClone(rt.subscriptions()), seen = events.length
    expect(rt.retarget(s.id, L)).toEqual({ ok: false, fail: { type: 'denied', reason: 'no log' } })
    expect(rt.subscriptions()).toEqual(before)
    expect(events.length).toBe(seen)
  })
  test('a throwing policy on subscribe is a denial, observed', () => {
    const { rt, events } = setup({ policy: { isAllowed: () => { throw new Error('bad policy') } } })
    expect(rt.subscribe(tickToLog)).toEqual({ ok: false, fail: { type: 'denied', reason: 'policy threw: bad policy' } })
    expect(events).toEqual([{ type: 'failure', coord: T, reason: 'policy threw: bad policy' }])
  })
  test('subscribe and retarget reject ends that are not coords', () => {
    const { rt } = setup()
    const bad = { ok: false, fail: { type: 'invalid-input' } }
    expect(rt.subscribe({ ...tickToLog, to: 'nohash' })).toMatchObject(bad)
    expect(rt.subscribe({ ...tickToLog, from: 'log#0' })).toMatchObject(bad)
    expect(rt.subscribe({ ...tickToLog, source: '' })).toMatchObject(bad)
    expect(rt.subscribe({ ...tickToLog, kind: 'stream' } as never)).toMatchObject(bad)
    rt.subscribe(tickToLog)
    expect(rt.retarget('s1', 'nohash')).toMatchObject(bad)
    expect(rt.subscriptions()).toEqual([{ id: 's1', ...tickToLog }])
  })
  test('retarget moves a subscription to a new target', () => {
    const { rt, add } = setup()
    add(ticker); add(memLog)
    rt.subscribe({ ...tickToLog, to: 'acme/log/mem#1' })
    expect(rt.retarget('s1', L)).toEqual(success(undefined))
    expect(rt.subscriptions()[0]).toMatchObject({ to: L })
    expect(rt.status('s1')).toBe('live')
  })
  test('unregistering a pod deletes the subscriptions naming it, then announces its removal', () => {
    const { rt, add, events } = setup()
    add(ticker); add(memLog)
    rt.subscribe(tickToLog)
    events.length = 0
    expect(rt.unregister(L)).toEqual(success(undefined))
    expect(rt.subscriptions()).toEqual([])
    expect(rt.status('s1')).toBeUndefined()
    expect(events).toEqual([{ type: 'subscription-removed', id: 's1', reason: 'cascade' }, { type: 'pod-removed', coord: L }])
  })
  test("reorder changes a consumer's call order; a partial list fails not-found", () => {
    const { rt } = setup()
    rt.subscribe({ kind: 'call', from: M, to: D })
    rt.subscribe(tickToLog)
    rt.subscribe({ kind: 'call', from: M, to: 'acme/db/file#0' })
    expect(rt.reorder(M, ['s3', 's1'])).toEqual(success(undefined))
    expect(rt.subscriptions().map(s => s.id)).toEqual(['s3', 's2', 's1'])
    expect(rt.reorder(M, ['s3'])).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('a reorder the policy denies changes nothing', () => {
    let deny = false
    const { rt } = setup({ policy: { isAllowed: () => (deny ? { approved: false, reason: 'no' } : { approved: true }) } })
    rt.subscribe({ kind: 'call', from: M, to: D })
    rt.subscribe({ kind: 'call', from: M, to: 'acme/db/file#0' })
    deny = true
    expect(rt.reorder(M, ['s2', 's1'])).toEqual({ ok: false, fail: { type: 'denied', reason: 'no' } })
    expect(rt.subscriptions().map(s => s.id)).toEqual(['s1', 's2'])
  })
  test('unsubscribe removes the subscription and announces it', () => {
    const { rt, events } = setup()
    rt.subscribe(tickToLog)
    expect(rt.unsubscribe('s1')).toEqual(success(undefined))
    expect(rt.unsubscribe('s1')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(rt.status('s1')).toBeUndefined()
    expect(events.at(-1)).toEqual({ type: 'subscription-removed', id: 's1', reason: 'unsubscribed' })
  })
  test('status events fire only on change', () => {
    const { rt, events, add } = setup()
    add(ticker)
    rt.subscribe(tickToLog)
    add(memDb); add(memLog); add(fileDb)
    expect(events.filter(e => e.type === 'status')).toEqual([{ type: 'status', id: 's1', status: 'waiting' }, { type: 'status', id: 's1', status: 'live' }])
  })
})

describe('connecting by selector', () => {
  test('each end resolves once to one registered pod, and the coords are what is saved', () => {
    const { rt, add } = setup()
    add(ticker); add(memLog)
    expect(rt.subscribe({ kind: 'event', from: { implementation: 'acme/clock/ticker' }, source: TICK, to: { implements: 'acme/log' }, target: WRITE }))
      .toEqual(success({ id: 's1', ...tickToLog }))
    expect(rt.subscribe({ kind: 'call', from: { coord: M }, to: D })).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('two matches fail ambiguous, none fails not-found, and nothing is added', () => {
    const { rt, add } = setup()
    const m = add(app)
    add(memDb); add(fileDb)
    expect(rt.subscribe({ kind: 'call', from: m, to: { implements: 'acme/db' } })).toMatchObject({ ok: false, fail: { type: 'ambiguous', reason: expect.stringContaining('2 match') } })
    expect(rt.subscribe({ kind: 'call', from: m, to: { implements: 'acme/nope' } })).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(rt.subscriptions()).toEqual([])
  })
  test('tags narrow an end', () => {
    const tags = new Map([['acme/db/file#0', new Set(['cache'])]])
    const { rt, add } = setup({ tagsOf: c => tags.get(c) ?? new Set() })
    const m = add(app)
    add(memDb); add(fileDb)
    expect(rt.subscribe({ kind: 'call', from: m, to: { implements: 'acme/db', tags: ['cache'] } })).toMatchObject({ ok: true, value: { to: 'acme/db/file#0' } })
  })
  test('a malformed end fails invalid-input and never throws', () => {
    const { rt } = setup()
    for (const end of [{}, { implements: 3 }, { implements: 'acme/db', tags: [1] }, null] as never[])
      expect(rt.subscribe({ kind: 'call', from: M, to: end })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
})
