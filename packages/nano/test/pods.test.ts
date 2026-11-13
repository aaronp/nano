// @ts-nocheck — the pods revision isn't built yet; remove when it lands (plan: pods revision)
/**
 * The pods revision, written first: pods own their instances (`<pod>#<n>`), `connect` resolves two selectors to two
 * concrete coords once, unavailable ends wait and deleted ends cascade, and the application starts runtimes.
 * Every test is `test.todo` until the plan lands: `bun test --todo test/pods.test.ts` runs them (red today).
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, portKey, type Interface } from '../src/iface.ts'
import { success, type NanoResult } from '../src/result.ts'
import { implementation, provide, type Handler, type Implementation } from '../src/implementation.ts'
import { provider } from '../src/provider.ts'
import { createRegistry } from '../src/registry.ts'
import type { Policy } from '../src/policy.ts'
import type { NanoContext } from '../src/context.ts'
import type { Selector } from '../src/selector.ts'
import { createApplication } from '../src/application.ts'

const Str = defineSchema('Str', Type.String())
const face = (coord: string) => iface(coord, { ping: op.action('ping', Str, Str) })
const Vault = face('acme/vault'), Audit = face('acme/audit')
const Ticks = iface('acme/ticks', { tick: op.source('tick', Str) })
const Log = iface('acme/log', { write: op.sink('write', Str) })
const TICK = portKey(Ticks.coord, Ticks.ops.tick.coord), WRITE = portKey(Log.coord, Log.ops.write.coord)

const contexts = new Map<string, NanoContext>()
const echo = (prefix: string): Handler => async (_c, s) => success(`${prefix} ${s}`)
const impl = (coord: string, provides: Interface[], dependencies: Record<string, Selector> = {}, ping = echo(coord)): Implementation =>
  implementation(coord, { provides, dependencies, make: ctx => { contexts.set(ctx.instance, ctx); return provides.map(i => provide(i, { ping })) } })

// While `failing` is set, every flaky make throws: the instance it was making is `failed`.
let failing = false
const flaky = implementation('acme/keys/flaky', { provides: [Vault], make: ctx => {
  if (failing) throw new Error('vault down')
  contexts.set(ctx.instance, ctx)
  return [provide(Vault, { ping: echo('flaky') })]
} })
let made2 = 0 // how many times vault2 was made: a swap at home makes it once, however many runtimes hold the pod
const vault2 = implementation('acme/keys/vault2', { provides: [Vault], make: () => { made2++; return [provide(Vault, { ping: echo('v2') })] } })
// A make held open until the test lets it go.
let release = () => {}
const slow = implementation('acme/keys/slow', { provides: [Vault], make: async () => {
  await new Promise<void>(r => { release = r })
  return [provide(Vault, { ping: echo('slow') })]
} })
// A dependency that is held open, so a test can act while a provisioning pass waits on it.
const Held = face('acme/held')
let releaseHeld = () => {}
const held = implementation('acme/keys/held', { provides: [Held], make: async () => { await new Promise<void>(r => { releaseHeld = r }); return [provide(Held, { ping: echo('held') })] } })
const needsHeld = impl('acme/ui/needs-held', [], { h: Held })
const vault = impl('acme/keys/vault', [Vault, Audit]) // vault2 keeps Vault and loses Audit
const user = impl('acme/ui/user', [], { vault: Vault })
const auditor = impl('acme/ui/auditor', [], { audit: Audit })
const ticker = impl('acme/clock/ticker', [Ticks])
const log = implementation('acme/log/mem', { provides: [Log], make: () => [provide(Log, { write: async () => success(undefined) })] })

const registry = () => {
  const r = createRegistry()
  r.add(provider('acme/keys', [vault, vault2, flaky, slow, held]))
  r.add(provider('acme/ui', [user, auditor, needsHeld]))
  r.add(provider('acme/clock', [ticker]))
  r.add(provider('acme/log', [log]))
  return r
}
/** The application is its own root runtime, and holds the tags. */
const setup = (policy?: Policy) => createApplication('app', { registry: registry(), ...(policy && { policy }) })

const first = (pod: string) => ({ target: { pod }, instance: { by: 'first' } })
const at = (pod: string, index: number) => ({ target: { pod }, instance: { by: 'index', index } })
const call = (from: string, to: string) => ({ kind: 'call', from: first(from), to: first(to) })
const tickToLog = { kind: 'event', from: first('ticks'), source: TICK, to: first('log'), target: WRITE }
const edges = (rt: ReturnType<typeof setup>) => rt.subscriptions().map(s => `${s.from} -> ${s.to} ${rt.status(s.id)}`)
const ping = (coord: string, s: string): Promise<NanoResult<string>> => contexts.get(coord)!.one(Vault, v => v.ping(s))

beforeEach(() => { failing = false; made2 = 0 })

describe('pod basics', () => {
  test('given an implementation, when a pod is created with count 2, then it has instances vault#0 and vault#1', async () => {
    const rt = setup()
    expect(await rt.create('vault', 'acme/keys/vault', { count: 2 })).toEqual(success({ pod: 'vault', instances: ['vault#0', 'vault#1'], unsatisfied: [] }))
  })
  test('given no count, when a pod is created, then it has one instance, vault#0', async () => {
    const rt = setup()
    expect(await rt.create('vault', 'acme/keys/vault')).toEqual(success({ pod: 'vault', instances: ['vault#0'], unsatisfied: [] }))
  })
  test('given a pod, when it is asked for by id, then it reports its implementation, config, count, state and instances', async () => {
    const rt = setup()
    await rt.create('vault', 'acme/keys/vault', { config: { region: 'eu' }, count: 2 })
    expect(rt.pod('vault')).toEqual({
      id: 'vault', implementation: 'acme/keys/vault', config: { region: 'eu' }, count: 2, state: 'running', home: 'app',
      instances: [{ coord: 'vault#0', state: 'running' }, { coord: 'vault#1', state: 'running' }],
    })
    expect(rt.pod('nope')).toBeUndefined()
  })
  test('given a pod id in use, when another pod is created with it, then it fails exists', async () => {
    const rt = setup()
    await rt.create('vault', 'acme/keys/vault')
    expect(await rt.create('vault', 'acme/ui/user')).toMatchObject({ ok: false, fail: { type: 'exists' } })
    expect(rt.pod('vault')!.implementation).toBe('acme/keys/vault')
  })
  test("given an instance whose make throws, when its pod is created, then the create succeeds and the pod's state is failed", async () => {
    const rt = setup()
    failing = true
    expect(await rt.create('vault', 'acme/keys/flaky')).toMatchObject({ ok: true, value: { instances: ['vault#0'] } })
    expect(rt.pod('vault')).toMatchObject({ state: 'failed', instances: [{ coord: 'vault#0', state: 'failed' }] })
  })
  test('given one failed instance and one running, when the pod is asked for, then its state is failed', async () => {
    const rt = setup()
    failing = true
    await rt.create('vault', 'acme/keys/flaky')
    failing = false
    await rt.addInstance('vault')
    expect(rt.pod('vault')).toMatchObject({ state: 'failed', instances: [{ coord: 'vault#0', state: 'failed' }, { coord: 'vault#1', state: 'running' }] })
  })
  test('given an instance still being made, when the pod is asked for, then it and its pod are starting', async () => {
    const rt = setup()
    const pending = rt.create('vault', 'acme/keys/slow')
    await new Promise(r => setTimeout(r, 0))
    expect(rt.pod('vault')).toMatchObject({ state: 'starting', instances: [{ coord: 'vault#0', state: 'starting' }] })
    release()
    await pending
    expect(rt.pod('vault')!.state).toBe('running')
  })
  test('given an unknown implementation, when a pod is created, then it fails not-found and adds nothing', async () => {
    const rt = setup()
    expect(await rt.create('vault', 'acme/nope/x')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(rt.pod('vault')).toBeUndefined()
  })
})

describe('connecting', () => {
  test('given two pods, when connected first-to-first, then the saved subscription holds the concrete coords, not the selectors', async () => {
    const rt = setup()
    await rt.create('user', 'acme/ui/user')
    await rt.create('vault', 'acme/keys/vault')
    expect(rt.connect(call('user', 'vault'))).toEqual(success({ id: 's1', kind: 'call', from: 'user#0', to: 'vault#0' }))
    expect(rt.subscriptions()).toEqual([{ id: 's1', kind: 'call', from: 'user#0', to: 'vault#0' }])
    expect(rt.status('s1')).toBe('live')
  })
  test('given a source and a sink, when an event connection is made, then it subscribes the source port to the target port', async () => {
    const rt = setup()
    await rt.create('ticks', 'acme/clock/ticker')
    await rt.create('log', 'acme/log/mem')
    expect(rt.connect(tickToLog)).toEqual(success({ id: 's1', kind: 'event', from: 'ticks#0', source: TICK, to: 'log#0', target: WRITE }))
  })
  test('given an end without an instance selector, when connecting, then it fails invalid-input and adds nothing', async () => {
    const rt = setup()
    await rt.create('user', 'acme/ui/user')
    await rt.create('vault', 'acme/keys/vault')
    expect(rt.connect({ kind: 'call', from: first('user'), to: { target: { pod: 'vault' } } })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(rt.connect({ kind: 'call', from: { instance: { by: 'first' } }, to: first('vault') })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(rt.subscriptions()).toEqual([])
  })
  test('given no instance matching an end, when connecting, then it fails nothing matches and adds nothing', async () => {
    const rt = setup()
    await rt.create('user', 'acme/ui/user')
    expect(rt.connect(call('user', 'vault'))).toMatchObject({ ok: false, fail: { type: 'not-found', reason: expect.stringContaining('nothing matches') } })
    expect(rt.subscriptions()).toEqual([])
  })
  // Behaviour 1.
  test('given a source pod with two cache-tagged instances, when a sink connects to tags [cache], then it fails 2 match and adds nothing', async () => {
    const rt = setup()
    await rt.create('ticks', 'acme/clock/ticker', { count: 2 })
    await rt.create('log', 'acme/log/mem')
    rt.tag('ticks#0', 'cache'); rt.tag('ticks#1', 'cache')
    const r = rt.connect({ ...tickToLog, from: { target: { pod: 'ticks' }, instance: { by: 'tags', tags: ['cache'] } } })
    expect(r).toMatchObject({ ok: false, fail: { type: 'ambiguous', reason: expect.stringContaining('2 match') } })
    expect(rt.subscriptions()).toEqual([])
  })
  test('given one of two instances tagged cache, when connecting by tags [cache], then it chooses that instance', async () => {
    const rt = setup()
    await rt.create('user', 'acme/ui/user')
    await rt.create('vault', 'acme/keys/vault', { count: 2 })
    rt.tag('vault#1', 'cache')
    expect(rt.connect({ kind: 'call', from: first('user'), to: { target: { pod: 'vault' }, instance: { by: 'tags', tags: ['cache'] } } }))
      .toMatchObject({ ok: true, value: { to: 'vault#1' } })
  })
  test('given two pods implementing Vault, when connecting to implements Vault by index 0, then it fails 2 match: index is the coord index', async () => {
    const rt = setup()
    await rt.create('user', 'acme/ui/user')
    await rt.create('vault', 'acme/keys/vault')
    await rt.create('spare', 'acme/keys/vault2')
    const to = (index: number) => ({ target: { implements: 'acme/vault' }, instance: { by: 'index', index } })
    expect(rt.connect({ kind: 'call', from: first('user'), to: to(0) })).toMatchObject({ ok: false, fail: { type: 'ambiguous', reason: expect.stringContaining('2 match') } })
    expect(rt.subscriptions()).toEqual([])
  })
  test('given two pods of different implementations, when connecting to an implementation, then it chooses that pod’s instance', async () => {
    const rt = setup()
    await rt.create('user', 'acme/ui/user')
    await rt.create('vault', 'acme/keys/vault')
    await rt.create('spare', 'acme/keys/vault2')
    expect(rt.connect({ kind: 'call', from: first('user'), to: { target: { implementation: 'acme/keys/vault2' }, instance: { by: 'first' } } }))
      .toMatchObject({ ok: true, value: { to: 'spare#0' } })
  })
  test('given a failed vault#0, when connecting to it by index, then the subscription is made and waits', async () => {
    const rt = setup()
    await rt.create('user', 'acme/ui/user')
    failing = true
    await rt.create('vault', 'acme/keys/flaky')
    expect(rt.connect({ kind: 'call', from: first('user'), to: at('vault', 0) })).toMatchObject({ ok: true, value: { to: 'vault#0' } })
    expect(rt.status('s1')).toBe('waiting')
  })
  // Behaviour 9.
  test('given vault#0 failed and vault#1 running, when connecting by first, then it picks vault#1', async () => {
    const rt = setup()
    await rt.create('user', 'acme/ui/user')
    failing = true
    await rt.create('vault', 'acme/keys/flaky')
    failing = false
    await rt.addInstance('vault')
    expect(rt.connect(call('user', 'vault'))).toMatchObject({ ok: true, value: { to: 'vault#1' } })
    expect(rt.status('s1')).toBe('live')
  })
  test('given a connection, when an instance is later added that also matches, then the connection is unchanged', async () => {
    const rt = setup()
    await rt.create('user', 'acme/ui/user')
    await rt.create('vault', 'acme/keys/vault')
    rt.connect(call('user', 'vault'))
    rt.tag('vault#0', 'cache')
    await rt.addInstance('vault')
    rt.tag('vault#1', 'cache')
    expect(rt.subscriptions()).toEqual([{ id: 's1', kind: 'call', from: 'user#0', to: 'vault#0' }])
  })
  test('given a guest runtime with its own and a placed pod, when connecting to an interface both implement, then it fails 2 match; a placed-only match is chosen', async () => {
    const app = setup()
    app.createRuntime('home'); app.createRuntime('guest')
    const home = app.runtime('home')!, guest = app.runtime('guest')!
    await home.create('vault', 'acme/keys/vault')
    await guest.create('user', 'acme/ui/user')
    app.place('vault#0', 'home', 'guest')
    const to = (t: object) => ({ kind: 'call', from: first('user'), to: { target: t, instance: { by: 'first' } } })
    expect(guest.connect(to({ implements: 'acme/vault' }))).toMatchObject({ ok: true, value: { to: 'vault#0' } })
    guest.unsubscribe('s1')
    await guest.create('spare', 'acme/keys/vault2')
    expect(guest.connect(to({ implements: 'acme/vault' }))).toMatchObject({ ok: false, fail: { type: 'ambiguous', reason: expect.stringContaining('2 match') } })
    expect(guest.connect(to({ implementation: 'acme/keys/vault' }))).toMatchObject({ ok: true, value: { to: 'vault#0' } })
  })
  test('given a malformed end, when connecting, then it fails invalid-input and never throws', async () => {
    const rt = setup()
    await rt.create('user', 'acme/ui/user')
    for (const bad of [{ target: 5, instance: { by: 'first' } }, { target: { pod: 'user' }, instance: 'x' }, { target: { pod: 'user' }, instance: { by: 'nope' } }, { target: {}, instance: { by: 'first' } }])
      expect(rt.connect({ kind: 'call', from: first('user'), to: bad })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })
})

describe('removal during provisioning', () => {
  test('given a pod removed while its provisioning pass waits, then no subscription names its coords', async () => {
    const rt = setup()
    const made = rt.create('n', 'acme/ui/needs-held', { provision: true })
    await new Promise(r => setTimeout(r, 0))
    rt.remove('n')
    releaseHeld()
    await made
    expect(rt.subscriptions().filter(s => s.from.startsWith('n#') || s.to.startsWith('n#'))).toEqual([])
  })
})

describe('scaling', () => {
  // Behaviour 2.
  test('given log#0 connected, when log is scaled to two, then log#1 is added and the connection to log#0 is unchanged', async () => {
    const rt = setup()
    await rt.create('ticks', 'acme/clock/ticker')
    await rt.create('log', 'acme/log/mem')
    rt.connect(tickToLog)
    const before = structuredClone(rt.subscriptions())
    expect(await rt.scale('log', 2)).toEqual(success(['log#0', 'log#1']))
    expect(rt.pod('log')).toMatchObject({ count: 2, instances: [{ coord: 'log#0' }, { coord: 'log#1' }] })
    expect(rt.subscriptions()).toEqual(before)
    expect(rt.status('s1')).toBe('live')
  })
  test('given log#0 and log#1 each connected, when log is scaled to one, then log#1 and only its subscription go', async () => {
    const rt = setup()
    await rt.create('ticks', 'acme/clock/ticker')
    await rt.create('log', 'acme/log/mem', { count: 2 })
    rt.connect(tickToLog)
    rt.connect({ ...tickToLog, to: at('log', 1) })
    expect(await rt.scale('log', 1)).toEqual(success(['log#0']))
    expect(edges(rt)).toEqual(['ticks#0 -> log#0 live'])
  })
  // Behaviour 6.
  test('given log#0 removed, when an instance is added, then it is log#1, never a reused log#0', async () => {
    const rt = setup()
    await rt.create('log', 'acme/log/mem')
    expect(rt.removeInstance('log#0')).toEqual(success(undefined))
    expect(await rt.addInstance('log')).toEqual(success('log#1'))
    expect(rt.pod('log')).toMatchObject({ count: 1, instances: [{ coord: 'log#1' }] })
  })
  test('given log scaled down from two, when scaled back up, then the new instance is log#2', async () => {
    const rt = setup()
    await rt.create('log', 'acme/log/mem', { count: 2 })
    await rt.scale('log', 1)
    expect(await rt.scale('log', 2)).toEqual(success(['log#0', 'log#2']))
  })
})

describe('cascade and wait', () => {
  async function vaults() {
    const rt = setup()
    await rt.create('user', 'acme/ui/user', { count: 2 })
    await rt.create('vault', 'acme/keys/vault', { count: 2 })
    rt.connect({ kind: 'call', from: at('user', 0), to: at('vault', 0) })
    rt.connect({ kind: 'call', from: at('user', 1), to: at('vault', 1) })
    return rt
  }
  // Behaviour 3.
  test('given subscriptions to vault#0 and vault#1, when pod vault is removed, then every subscription naming vault#… is deleted', async () => {
    const rt = await vaults()
    expect(rt.remove('vault')).toEqual(success(undefined))
    expect(rt.subscriptions()).toEqual([])
    expect(rt.pod('vault')).toBeUndefined()
  })
  test('given subscriptions to vault#0 and vault#1, when instance vault#1 is removed, then only its subscription is deleted', async () => {
    const rt = await vaults()
    expect(rt.removeInstance('vault#1')).toEqual(success(undefined))
    expect(edges(rt)).toEqual(['user#0 -> vault#0 live'])
    expect(rt.pod('vault')).toMatchObject({ count: 1, instances: [{ coord: 'vault#0' }] })
  })
  test('given an unknown pod or instance, when it is removed, then it fails not-found', () => {
    const rt = setup()
    expect(rt.remove('nope')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(rt.removeInstance('nope#0')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  // Behaviour 4.
  test('given a failed vault#0, when subscribed to, then the subscription waits; when vault#0 is restarted, then it is live', async () => {
    const rt = setup()
    await rt.create('user', 'acme/ui/user')
    failing = true
    await rt.create('vault', 'acme/keys/flaky')
    rt.subscribe({ kind: 'call', from: 'user#0', to: 'vault#0' })
    expect(rt.status('s1')).toBe('waiting')
    expect(await ping('user#0', 'x')).toMatchObject({ ok: false, fail: { type: 'missing-component' } })
    failing = false
    expect(await rt.restart('vault#0')).toEqual(success(undefined))
    expect(rt.pod('vault')).toMatchObject({ state: 'running', instances: [{ coord: 'vault#0', state: 'running' }] })
    expect(rt.status('s1')).toBe('live')
    expect(await ping('user#0', 'x')).toEqual(success('flaky x'))
  })
  test('given a failed vault#0, when its restart fails again, then it stays failed and the subscription keeps waiting', async () => {
    const rt = setup()
    await rt.create('user', 'acme/ui/user')
    failing = true
    await rt.create('vault', 'acme/keys/flaky')
    rt.subscribe({ kind: 'call', from: 'user#0', to: 'vault#0' })
    expect(await rt.restart('vault#0')).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(rt.pod('vault')!.state).toBe('failed')
    expect(rt.status('s1')).toBe('waiting')
  })
})

describe('swap', () => {
  // Behaviour 5.
  test.todo('given vault with Vault and Audit connections, when swapped to an implementation with only Vault, then vault#0 is kept, Vault stays live and Audit is broken', async () => {
    const rt = setup()
    await rt.create('user', 'acme/ui/user')
    await rt.create('auditor', 'acme/ui/auditor')
    await rt.create('vault', 'acme/keys/vault')
    rt.connect(call('user', 'vault'))
    rt.connect(call('auditor', 'vault'))
    expect(await rt.swap('vault', 'acme/keys/vault2')).toEqual(success(undefined))
    expect(rt.pod('vault')).toMatchObject({ implementation: 'acme/keys/vault2', instances: [{ coord: 'vault#0', state: 'running' }] })
    expect(edges(rt)).toEqual(['user#0 -> vault#0 live', 'auditor#0 -> vault#0 broken'])
    expect(await ping('user#0', 'x')).toEqual(success('v2 x'))
  })
  test.todo('given a pod with config, when swapped with new config, then the pod reports the new config', async () => {
    const rt = setup()
    await rt.create('vault', 'acme/keys/vault', { config: { region: 'eu' } })
    await rt.swap('vault', 'acme/keys/vault2', { config: { region: 'us' } })
    expect(rt.pod('vault')).toMatchObject({ implementation: 'acme/keys/vault2', config: { region: 'us' } })
  })
  test.todo('given a tagged vault#0, when vault is swapped, then vault#0 keeps its tags', async () => {
    const rt = setup()
    await rt.create('vault', 'acme/keys/vault')
    rt.tag('vault#0', 'cache')
    await rt.swap('vault', 'acme/keys/vault2')
    expect(rt.tagsOf('vault#0')).toEqual(new Set(['cache']))
  })
  // Behaviour 7.
  test.todo('given vault placed from signer into client, when swapped at signer, then it is made once and client sees the new implementation behind vault#0', async () => {
    const app = setup()
    const home = app.createRuntime('signer'), client = app.createRuntime('client')
    if (!home.ok || !client.ok) throw new Error('setup')
    await home.value.create('vault', 'acme/keys/vault')
    expect(app.place('vault', 'signer', 'client')).toEqual(success(undefined))
    await client.value.create('user', 'acme/ui/user')
    client.value.connect(call('user', 'vault'))
    expect(await client.value.swap('vault', 'acme/keys/vault2')).toMatchObject({ ok: false, fail: { type: 'denied' } })
    expect(await home.value.swap('vault', 'acme/keys/vault2')).toEqual(success(undefined))
    expect(made2).toBe(1)
    expect(client.value.pod('vault')).toMatchObject({ implementation: 'acme/keys/vault2', instances: [{ coord: 'vault#0' }] })
    expect(edges(client.value)).toEqual(['user#0 -> vault#0 live'])
    expect(await ping('user#0', 'x')).toEqual(success('v2 x'))
  })
})

describe('start', () => {
  // Behaviour 8.
  test.todo("given a saved runtime whose pod's make fails, when it is started, then the runtime runs with that pod failed and its subscriptions waiting", async () => {
    const app = setup()
    app.define({
      id: 'r',
      pods: [{ id: 'user', implementation: 'acme/ui/user', count: 1 }, { id: 'vault', implementation: 'acme/keys/flaky', count: 1 }],
      members: [],
      subscriptions: [{ id: 's1', kind: 'call', from: 'user#0', to: 'vault#0' }],
    })
    failing = true
    const r = await app.start('r')
    expect(r.ok).toBe(true)
    const rt = app.runtime('r')!
    expect(r.ok && r.value).toBe(rt)
    expect(rt.pod('user')!.state).toBe('running')
    expect(rt.pod('vault')).toMatchObject({ state: 'failed', instances: [{ coord: 'vault#0', state: 'failed' }] })
    expect(rt.status('s1')).toBe('waiting')
  })
  test.todo('given a saved pod with count 2, when its runtime is started, then it has both instances', async () => {
    const app = setup()
    app.define({ id: 'r', pods: [{ id: 'vault', implementation: 'acme/keys/vault', count: 2 }], members: [], subscriptions: [] })
    await app.start('r')
    expect(app.runtime('r')!.pod('vault')).toMatchObject({ count: 2, state: 'running', instances: [{ coord: 'vault#0' }, { coord: 'vault#1' }] })
  })
  test.todo('given an application, when it is asked to open a runtime, then there is no open: start replaces it', () => {
    expect('open' in setup()).toBe(false)
  })
})

describe('calls through pods', () => {
  test('given user#0 connected to vault#0, when user calls vault, then the call is policed and counted on the subscription', async () => {
    const seen: string[] = []
    const rt = setup({ isAllowed: (src, dest) => { seen.push(`${src} -> ${dest}`); return { approved: true } } })
    await rt.create('user', 'acme/ui/user')
    await rt.create('vault', 'acme/keys/vault')
    rt.connect(call('user', 'vault'))
    seen.length = 0
    expect(await ping('user#0', 'x')).toEqual(success('acme/keys/vault x'))
    expect(seen).toEqual(['user#0 -> vault#0'])
    expect(rt.books('s1')).toEqual({ calls: 1, last: success('acme/keys/vault x') })
  })
})
