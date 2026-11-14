import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, type Interface } from '../src/iface.ts'
import { success, type NanoResult } from '../src/result.ts'
import { implementation, provide, type Handler } from '../src/implementation.ts'
import { provider } from '../src/provider.ts'
import { createRegistry, type Registry } from '../src/registry.ts'
import { Pod } from '../src/pod.ts'
import { createRuntime, type RuntimeEvent } from '../src/runtime/index.ts'
import { createApplication, type PodDef, type RuntimeDef } from '../src/application.ts'

const Str = defineSchema('Str', Type.String())
const face = (coord: string) => iface(coord, { ping: op.action('ping', Str, Str) })
const Vault = face('acme/vault'), Signer = face('acme/signer')
const echo: Handler = async (_c, s) => success(s)
const sign: Handler = async (ctx, s) => {
  const r: NanoResult<string> = await ctx.one(Vault, v => v.ping(s as string))
  return r.ok ? success(`signed ${r.value}`) : r
}
const impl = (coord: string, provides: Interface[], ping: Handler = echo, dependencies = {}) =>
  implementation(coord, { provides, dependencies, make: () => provides.map(i => provide(i, { ping })) })
const vault = impl('acme/keys/vault', [Vault])
const signer = impl('acme/keys/signer', [Signer], sign, { vault: Vault })
const registry = (): Registry => {
  const r = createRegistry()
  r.add(provider('acme/keys', [vault, signer]))
  return r
}
const V = 'acme/keys/vault#0', S = 'acme/keys/signer#0'
const ok = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

const pods: Record<string, PodDef> = { p0: { implementation: 'acme/keys/vault', config: { slot: 1 } }, p1: { implementation: 'acme/keys/signer' } }
const keys: RuntimeDef = {
  id: 'keys', pods: [{ coord: V, pod: 'p0' }, { coord: S, pod: 'p1' }],
  next: { 'acme/keys/vault': 3, 'acme/keys/signer': 1 }, subscriptions: [{ id: 's1', kind: 'call', from: S, to: V }],
}
const client: RuntimeDef = { id: 'client', pods: [{ coord: 'acme/keys/signer#4', pod: 'p1' }], next: {}, subscriptions: [] }
const defined = () => {
  const app = createApplication('app', { registry: registry() })
  ok(app.define({ pods, runtimes: [keys, client] }))
  return app
}

describe('the application', () => {
  test('is its own root runtime', () => {
    const app = createApplication('app', { registry: registry() })
    const v = ok(app.register(Pod.create(vault)))
    expect(app.runtime('app')!.pod(v)).toBe(app.pod(v))
    expect(app.runtimes()).toEqual([])
    expect(app.createRuntime('app')).toMatchObject({ ok: false, fail: { type: 'exists' } })
  })
  test('tags are shared, so a tag selector works in every runtime', () => {
    const app = createApplication('app', { registry: registry() })
    const a = ok(app.createRuntime('a'))
    const v = ok(a.register(Pod.create(vault))), s = ok(a.register(Pod.create(signer)))
    ok(a.register(Pod.create(vault)))
    app.tag(v, 'cache')
    expect(app.tagsOf(v)).toEqual(new Set(['cache']))
    expect(ok(a.subscribe({ kind: 'call', from: s, to: { implements: Vault.coord, tags: ['cache'] } })).to).toBe(v)
    app.untag(v, 'cache')
    expect(a.subscribe({ kind: 'call', from: s, to: { implements: Vault.coord, tags: ['cache'] } })).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('tags go when the coord is held nowhere, not when one runtime of two holding it lets go', () => {
    const app = createApplication('app', { registry: registry() })
    const a = ok(app.createRuntime('a')), b = ok(app.createRuntime('b'))
    ok(a.register(Pod.create(vault))); ok(b.register(Pod.create(vault)))
    app.tag(V, 'cache')
    ok(a.unregister(V))
    expect(app.tagsOf(V)).toEqual(new Set(['cache']))
    ok(b.unregister(V))
    expect(app.tagsOf(V)).toEqual(new Set())
  })
  test('an application can be adopted as a child of another', () => {
    const outer = createApplication('outer', { registry: registry() })
    const inner = createApplication('inner', { registry: registry() })
    expect(outer.adopt(inner)).toEqual(success(undefined))
    expect(outer.runtime('inner')).toBe(inner)
    expect(outer.runtimes()).toEqual(['inner'])
    expect(outer.adopted('inner')).toBe(true)
    expect(outer.adopt(inner)).toMatchObject({ ok: false, fail: { type: 'exists' } })
  })
})

describe('defining', () => {
  test('runtimes() lists started and defined runtimes; definition() gives the runtime back with the pods it refers to', () => {
    const app = defined()
    ok(app.createRuntime('made'))
    expect(app.runtimes()).toEqual(['made', 'keys', 'client'])
    expect(app.definition('client')).toEqual({ pods: { p1: pods.p1! }, runtimes: [{ ...client, policy: 'allow-all' }] })
    expect(app.definition('nope')).toBeUndefined()
  })
  test('define keeps its own copy', () => {
    const table = structuredClone(pods), def = structuredClone(keys)
    const app = createApplication('app', { registry: registry() })
    ok(app.define({ pods: table, runtimes: [def] }))
    ;(table.p0!.config as { slot: number }).slot = 9
    def.subscriptions.length = 0
    expect(app.definition('keys')).toEqual({ pods, runtimes: [{ ...keys, policy: 'allow-all' }] })
  })
  test('define refuses a runtime id taken or repeated, and a pod key already in the table; a refused define changes nothing', () => {
    const app = defined()
    ok(app.createRuntime('made'))
    for (const d of [{ pods: {}, runtimes: [keys] }, { pods: {}, runtimes: [{ ...client, id: 'made' }] }, { pods: { p0: pods.p0! }, runtimes: [] }] as { pods: Record<string, PodDef>; runtimes: RuntimeDef[] }[])
      expect(app.define(d)).toMatchObject({ ok: false, fail: { type: 'exists' } })
    expect(app.define({ pods: {}, runtimes: [{ ...client, id: 'x' }, { ...client, id: 'x' }] })).toMatchObject({ ok: false, fail: { type: 'exists' } })
    expect(app.define({ pods: { q: pods.p0! }, runtimes: [{ ...client, id: 'app2' }, keys] })).toMatchObject({ ok: false })
    expect(app.runtimes()).toEqual(['made', 'keys', 'client'])
    expect(app.define({ pods: { q: pods.p0! }, runtimes: [] })).toEqual(success(undefined)) // q was not taken by the refused one
  })
  test('define refuses what a document could not hold: bad ids, coords and configs that are not JSON', () => {
    const app = createApplication('app', { registry: registry() })
    const refused = { ok: false, fail: { type: 'invalid-input' } }
    expect(app.define({ pods: { 'a b': pods.p0! }, runtimes: [] })).toMatchObject(refused)
    expect(app.define({ pods: { p: { implementation: 'acme/keys/vault', config: () => 1 } }, runtimes: [] })).toMatchObject(refused)
    expect(app.define({ pods: {}, runtimes: [{ ...client, id: 'a/b' }] })).toMatchObject(refused)
    expect(app.define({ pods: {}, runtimes: [{ ...client, pods: [{ coord: 'v', pod: 'p0' }] }] })).toMatchObject(refused)
    expect(app.runtimes()).toEqual([])
  })
  test('at most 49 runtimes besides the root, made or defined; an adopted one is not counted', () => {
    const app = createApplication('app', { registry: registry() })
    for (let n = 0; n < 48; n++) ok(app.createRuntime(`r${n}`))
    ok(app.define({ pods: {}, runtimes: [{ ...client, id: 'd' }] }))
    expect(app.createRuntime('more')).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(app.define({ pods: {}, runtimes: [{ ...client, id: 'more' }] })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(app.adopt(createRuntime('adopted', { registry: registry() }))).toEqual(success(undefined))
  })
})

describe('starting', () => {
  test('registers each entry at its saved coord and restores the counters, so a coord is never reused', async () => {
    const app = defined()
    const rt = ok(await app.start('keys'))
    expect(rt.pods()).toEqual([V, S])
    expect(rt.pod(V)!.config).toEqual({ slot: 1 })
    expect(rt.status('s1')).toBe('live')
    expect(await rt.call(S).ping('x')).toEqual(success('signed x'))
    expect(rt.register(Pod.create(vault))).toEqual(success('acme/keys/vault#3'))
    expect(app.definition('keys')!.runtimes[0]!.next).toEqual({ 'acme/keys/vault': 4, 'acme/keys/signer': 1 })
  })
  test('a key referred to from two runtimes is made once: both register the same pod', async () => {
    const app = defined()
    const k = ok(await app.start('keys')), c = ok(await app.start('client'))
    expect(c.pod('acme/keys/signer#4')).toBe(k.pod(S)!)
    expect(k.pod(S)!.runtimes).toEqual(['keys', 'client'])
  })
  test('starting never starts another runtime and never provisions', async () => {
    const app = createApplication('app', { registry: registry() })
    ok(app.define({ pods: { p1: pods.p1! }, runtimes: [{ ...client, id: 'lone' }, keys] }))
    const rt = ok(await app.start('lone'))
    expect(rt.pods()).toEqual(['acme/keys/signer#4'])
    expect(app.runtime('keys')).toBeUndefined()
  })
  test('a started runtime is returned as it is; an id neither started nor defined fails not-found', async () => {
    const app = defined()
    const rt = ok(await app.start('keys'))
    expect(ok(await app.start('keys'))).toBe(rt)
    expect(await app.start('nope')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('what cannot be added is skipped with a note, also a warning on the root stream; the runtime starts with the rest', async () => {
    const app = createApplication('app', { registry: registry() })
    const warnings: string[] = []
    app.listen((e: RuntimeEvent) => { if (e.type === 'warning') warnings.push(e.reason) })
    ok(app.define({ pods: { ...pods, p9: { implementation: 'acme/nope/x' } }, runtimes: [{
      ...keys,
      pods: [...keys.pods, { coord: 'acme/keys/vault#1', pod: 'ghost' }, { coord: 'acme/nope/x#0', pod: 'p9' }],
      subscriptions: [...keys.subscriptions, { id: 's1', kind: 'call', from: V, to: S }],
    }] }))
    const rt = ok(await app.start('keys'))
    expect(rt.pods()).toEqual([V, S])
    expect(app.notes()).toEqual([
      'keys/acme/keys/vault#1: no pod ghost in the pods table',
      'keys/acme/nope/x#0: no implementation acme/nope/x',
      'keys/s1: subscription s1 exists',
    ])
    expect(warnings).toEqual([...app.notes()])
  })
  test('a pod made for an entry that cannot be registered is let go; one another runtime already holds is kept', async () => {
    let makes = 0
    const counted = implementation('acme/keys/counted', { provides: [Vault], make: () => { makes++; return [provide(Vault, { ping: async (_c, s) => success(s) })] } })
    const reg = createRegistry()
    reg.add(provider('acme/keys', [vault, counted]))
    const app = createApplication('app', { registry: reg })
    const C = 'acme/keys/counted#0', wrong = (id: string): RuntimeDef => ({ id, pods: [{ coord: V, pod: 'p5' }], next: {}, subscriptions: [] }) // p5 is no vault
    ok(app.define({ pods: { p5: { implementation: 'acme/keys/counted' } }, runtimes: [wrong('x'), { ...wrong('a'), pods: [{ coord: C, pod: 'p5' }] }, wrong('y')] }))
    ok(await app.start('x'))
    expect(makes).toBe(1)
    const a = ok(await app.start('a'))
    expect(makes).toBe(2) // made afresh: the one `x` made was let go
    ok(await app.start('y'))
    expect(a.pod(C)!.state).not.toBe('stopped')
  })
  test('a key given to a live pod never collides with one defined later: that pod takes another key', async () => {
    const app = createApplication('app', { registry: registry() })
    const a = ok(app.createRuntime('a'))
    const live = Pod.create(vault)
    ok(a.register(live))
    expect(Object.keys(app.definition('a')!.pods)).toEqual(['p0'])
    ok(app.define({ pods: { p0: pods.p0! }, runtimes: [{ id: 'b', pods: [{ coord: V, pod: 'p0' }], next: {}, subscriptions: [] }] }))
    expect(ok(await app.start('b')).pod(V)).not.toBe(live)
    expect(Object.keys(app.definition('a')!.pods)).toEqual(['p1'])
  })
  test('a root start that throws takes back only what it registered, and lets go of the pods it made', async () => {
    const reg = registry()
    const app = createApplication('app', { registry: { ...reg, implementation: c => { if (c === 'acme/keys/signer') throw new Error('bang'); return reg.implementation(c) } } })
    ok(app.define({ pods, runtimes: [{ ...keys, id: 'app', pods: [{ coord: 'acme/keys/vault#5', pod: 'p0' }, { coord: S, pod: 'p1' }] }] }))
    const mine = ok(app.register(Pod.create(vault)))
    const made: Pod[] = []
    app.listen(e => { if (e.type === 'pod-created') made.push(app.pod(e.coord)!) })
    expect(await app.start('app')).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(app.pods()).toEqual([mine])
    expect(made.map(p => p.state)).toEqual(['stopped'])
    expect(app.pod(mine)!.state).not.toBe('stopped')
  })
  test('start never rejects: a throw while building fails threw, and the runtime stays defined', async () => {
    const reg = registry()
    const app = createApplication('app', { registry: { ...reg, implementation: c => { if (c === 'acme/keys/signer') throw new Error('bang'); return reg.implementation(c) } } })
    ok(app.define({ pods, runtimes: [keys] }))
    expect(await app.start('keys')).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(app.runtime('keys')).toBeUndefined()
    expect(app.runtimes()).toEqual(['keys'])
  })
})
