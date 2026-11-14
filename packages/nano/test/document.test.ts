import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, portKey, type Interface } from '../src/iface.ts'
import { success, type NanoResult } from '../src/result.ts'
import { implementation, provide, type Handler } from '../src/implementation.ts'
import { provider } from '../src/provider.ts'
import { createRegistry } from '../src/registry.ts'
import { Pod } from '../src/pod.ts'
import { createRuntime, type Runtime } from '../src/runtime/index.ts'
import { createApplication, type Application } from '../src/application.ts'
import { checkDoc, loadDoc, saveDoc, type NanoDoc, type RuntimeDef } from '../src/document.ts'

const Str = defineSchema('Str', Type.String())
const face = (coord: string) => iface(coord, { ping: op.action('ping', Str, Str) })
const Vault = face('acme/vault'), Signer = face('acme/signer')
const Ticks = iface('acme/ticks', { tick: op.source('tick', Str) })
const echo: Handler = async (_c, s) => success(s)
const sign: Handler = async (ctx, s) => {
  const r: NanoResult<string> = await ctx.one(Vault, v => v.ping(s as string))
  return r.ok ? success(`signed ${r.value}`) : r
}
const impl = (coord: string, provides: Interface[], ping: Handler = echo, dependencies = {}) =>
  implementation(coord, { provides, dependencies, make: () => provides.map(i => provide(i, { ping })) })
const vault = impl('acme/keys/vault', [Vault]), ticker = impl('acme/keys/ticker', [Ticks])
const signer = impl('acme/keys/signer', [Signer], sign, { vault: Vault })
const tester = impl('acme/ui/tester', [], echo, { signer: Signer })
const registry = () => {
  const r = createRegistry()
  r.add(provider('acme/keys', [vault, signer, ticker]))
  r.add(provider('acme/ui', [tester]))
  return r
}
const V = 'acme/keys/vault#0', S = 'acme/keys/signer#0', T = 'acme/ui/tester#0'
const ok = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const reg = (rt: Runtime, pod: Pod) => ok(rt.register(pod))
const spare: RuntimeDef = { id: 'spare', policy: 'allow-all', pods: [{ coord: 'acme/keys/vault#7', pod: 'p3' }], next: { 'acme/keys/vault': 8 }, subscriptions: [] }

/** Root holds a vault `w`; `signer` holds a vault and the signer, wired; `client` holds the tester and the same signer; `spare` is only defined. */
function setup() {
  const app = createApplication('app', { registry: registry() })
  const sr = ok(app.createRuntime('signer')), cr = ok(app.createRuntime('client'))
  reg(app, Pod.create(vault, { config: { root: true } }))
  reg(sr, Pod.create(vault, { config: { slot: 1 } }))
  const s = Pod.create(signer)
  reg(sr, s)
  ok(sr.subscribe({ kind: 'call', from: S, to: V }))
  reg(cr, Pod.create(tester))
  reg(cr, s)
  ok(cr.subscribe({ kind: 'call', from: T, to: S }))
  ok(app.define({ pods: { p3: { implementation: 'acme/keys/vault' } }, runtimes: [spare] }))
  app.tag(T, 'ui'); app.tag(V, 'keys'); app.tag(V, 'hot'); app.tag('acme/keys/vault#7', 'spare'); app.tag(S, 'gone'); app.untag(S, 'gone')
  return app
}

/** What a round trip must keep: each runtime's pods (coord, implementation, config), subscriptions in order with status, and tags. */
function snapshot(app: Application) {
  const runtimes = [app.id, ...app.runtimes()].map(id => {
    const rt = app.runtime(id)
    if (!rt) return { id, definition: (d => d && d.runtimes[0]!.pods.map(p => ({ coord: p.coord, ...d.pods[p.pod] })))(app.definition(id)) }
    return {
      id,
      pods: rt.pods().map(c => ({ c, implementation: rt.pod(c)!.implementation, config: rt.pod(c)!.config })),
      subscriptions: rt.subscriptions().map(s => ({ ...s, status: rt.status(s.id) })),
    }
  })
  return { runtimes, tags: Object.fromEntries([S, V, T, 'acme/keys/vault#7'].map(c => [c, [...app.tagsOf(c)]])) }
}
const load = (doc: NanoDoc) => loadDoc(doc, { registry: registry() })

describe('saving and loading', () => {
  test('a round trip gives the same runtimes, pods, subscriptions in order, and tags', async () => {
    const app = setup()
    const doc = saveDoc(app, { title: 'Signer' })
    expect(checkDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
    const { app: back, notes } = await load(doc)
    expect(notes).toEqual([])
    expect(snapshot(back)).toEqual(snapshot(app))
    expect(await back.runtime('client')!.call(S).ping('x')).toEqual(success('signed x')) // its vault is wired in `signer`
    expect(back.runtime('client')!.pod(S)).toBe(back.runtime('signer')!.pod(S)!)
  })
  test('one pods table, keyed p0, p1, … in first-registered order (root first); runtimes refer to it with their counters', () => {
    const doc = saveDoc(setup())
    expect(doc.pods).toEqual({
      p0: { implementation: 'acme/keys/vault', config: { root: true } },
      p1: { implementation: 'acme/keys/vault', config: { slot: 1 } },
      p2: { implementation: 'acme/keys/signer' },
      p3: { implementation: 'acme/ui/tester' },
      p4: { implementation: 'acme/keys/vault' },
    })
    expect(doc.runtimes.find(r => r.id === 'client')).toEqual({
      id: 'client', policy: 'allow-all',
      pods: [{ coord: T, pod: 'p3' }, { coord: S, pod: 'p2' }],
      next: { 'acme/ui/tester': 1, 'acme/keys/signer': 1 },
      subscriptions: [{ id: 's1', kind: 'call', from: T, to: S }],
    })
  })
  test('the document lists the providers in use, the runtimes to start, and only coords with a tag', () => {
    const doc = saveDoc(setup(), { title: 'Signer', workspaces: [{ any: 'thing' }] })
    expect(doc).toMatchObject({ nano: 2, title: 'Signer', providers: ['acme/keys', 'acme/ui'], start: ['app', 'signer', 'client'], workspaces: [{ any: 'thing' }] })
    expect(doc.tags).toEqual({ [T]: ['ui'], [V]: ['keys', 'hot'], 'acme/keys/vault#7': ['spare'] })
  })
  test('an unstarted runtime is saved from its definition; only the runtimes in `start` start on load', async () => {
    const doc = saveDoc(setup())
    expect(doc.runtimes.find(r => r.id === 'spare')).toEqual({ ...spare, pods: [{ coord: 'acme/keys/vault#7', pod: 'p4' }] })
    const { app } = await load(doc)
    expect(app.runtime('spare')).toBeUndefined()
    expect(ok(await app.start('spare')).pods()).toEqual(['acme/keys/vault#7'])
  })
  test('a pod in a started and an unstarted runtime stays one entry across another save', async () => {
    const app = createApplication('app', { registry: registry() })
    const a = ok(app.createRuntime('a')), b = ok(app.createRuntime('b'))
    const p = Pod.create(vault)
    reg(a, p); reg(b, p)
    const doc = { ...saveDoc(app), start: ['a'] }
    const again = saveDoc((await load(doc)).app)
    expect(Object.keys(again.pods)).toEqual(['p0'])
    expect(again.runtimes.map(r => r.pods)).toEqual([[{ coord: V, pod: 'p0' }], [{ coord: V, pod: 'p0' }]])
  })
  test('the root is saved under the application id only when it holds pods or subscriptions; under another id it loads as a child, started', async () => {
    const bare = createApplication('bare', { registry: registry() })
    ok(bare.createRuntime('r'))
    expect(saveDoc(bare).runtimes.map(r => r.id)).toEqual(['r'])
    const { app, notes } = await loadDoc(saveDoc(setup()), { registry: registry(), id: 'other' })
    expect(notes).toEqual([])
    expect(app.runtime('app')!.pods()).toEqual([V])
  })
  test('an adopted runtime is not saved, nor a custom policy (loaded as allow-all, with a note)', async () => {
    const app = createApplication('app', { registry: registry() })
    app.adopt(createRuntime('outside', { registry: registry() }))
    ok(app.createRuntime('locked', { policy: { isAllowed: () => ({ approved: false, reason: 'no' }) } }))
    const doc = saveDoc(app)
    expect(doc.runtimes).toEqual([{ id: 'locked', pods: [], next: {}, subscriptions: [] }])
    const { app: back, notes } = await load(doc)
    expect(notes).toEqual(['locked: saved with a custom policy; loaded with allow-all'])
    expect(back.runtime('locked')!.policy.isAllowed(V, V, undefined)).toEqual({ approved: true })
  })
  test('given vault#0 unregistered, when saved and loaded, then the next vault is #1, never #0', async () => {
    const app = createApplication('app', { registry: registry() })
    const r = ok(app.createRuntime('r'))
    reg(r, Pod.create(vault))
    ok(r.unregister(V))
    const back = (await load(saveDoc(app))).app
    expect(back.runtime('r')!.register(Pod.create(vault))).toEqual(success('acme/keys/vault#1'))
  })
  test('an event subscription survives a round trip, live', async () => {
    const app = createApplication('app', { registry: registry() })
    const r = ok(app.createRuntime('r'))
    const k = reg(r, Pod.create(ticker)), v = reg(r, Pod.create(vault))
    ok(r.subscribe({ id: 'e', kind: 'event', from: k, source: portKey(Ticks.coord, Ticks.ops.tick.coord), to: v, target: portKey(Vault.coord, Vault.ops.ping.coord) }))
    const { app: back, notes } = await load(saveDoc(app))
    expect(notes).toEqual([])
    expect(back.runtime('r')!.status('e')).toBe('live')
  })
  test('changing the saved document never changes a running or defined config', () => {
    const app = setup()
    const doc = saveDoc(app)
    ;(doc.pods.p1!.config as { slot: number }).slot = 9
    doc.pods.p4!.config = 'changed'
    expect(app.runtime('signer')!.pod(V)!.config).toEqual({ slot: 1 })
    expect(app.definition('spare')!.pods).toEqual({ p3: { implementation: 'acme/keys/vault' } })
  })
})

describe('loading what does not fit', () => {
  const doc = (runtimes: RuntimeDef[], extra: Partial<NanoDoc> = {}): NanoDoc => ({
    nano: 2, title: 't', providers: [], tags: {}, start: runtimes.map(r => r.id),
    pods: { p0: { implementation: 'acme/keys/vault' }, p1: { implementation: 'acme/nope/x' } },
    runtimes: runtimes.map(r => ({ policy: 'allow-all', ...r })), ...extra,
  })
  const r = (pods: RuntimeDef['pods'], subscriptions: RuntimeDef['subscriptions'] = []): RuntimeDef => ({ id: 'r', pods, next: {}, subscriptions })

  test('an unknown implementation or pod key gives a note naming it, and the rest loads', async () => {
    const { app, notes } = await load(doc([r(
      [{ coord: 'acme/nope/x#0', pod: 'p1' }, { coord: 'acme/keys/vault#1', pod: 'p7' }, { coord: V, pod: 'p0' }],
      [{ id: 's1', kind: 'call', from: 'acme/nope/x#0', to: V }],
    )], { providers: ['acme/keys', 'acme/nope'] }))
    expect(notes).toEqual(['provider acme/nope is not registered', 'r/acme/nope/x#0: no implementation acme/nope/x', 'r/acme/keys/vault#1: no pod p7 in the pods table'])
    expect(app.runtime('r')!.pods()).toEqual([V])
    expect(app.runtime('r')!.status('s1')).toBe('waiting')
  })
  test('a subscription that cannot be added, or a runtime that cannot be defined, gives a note and the rest loads', async () => {
    const twice = { id: 's1', kind: 'call' as const, from: V, to: V }
    const { app, notes } = await load(doc([r([{ coord: V, pod: 'p0' }], [twice, twice]), r([])]))
    expect(notes).toEqual(['r: runtime r exists', 'r/s1: subscription s1 exists'])
    expect(app.runtime('r')!.subscriptions()).toEqual([twice])
  })
  test('tags are applied only to what is held after loading', async () => {
    const { app } = await load(doc([r([{ coord: 'acme/nope/x#0', pod: 'p1' }, { coord: V, pod: 'p0' }])], { tags: { 'acme/nope/x#0': ['lost'], [V]: ['kept'] } }))
    expect([...app.tagsOf('acme/nope/x#0')]).toEqual([])
    expect([...app.tagsOf(V)]).toEqual(['kept'])
  })
  test('an invalid document gives its reason as a note and an empty application', async () => {
    const { app, notes } = await load({ nano: 1 } as unknown as NanoDoc)
    expect(notes).toEqual(['not a nano v2 document'])
    expect(app.runtimes()).toEqual([])
  })
})

describe('the document limits hold for what is built live', () => {
  const refused = { ok: false, fail: { type: 'invalid-input' } }
  const roundTrip = async (app: Application) => {
    const doc = saveDoc(app)
    expect(typeof checkDoc(JSON.parse(JSON.stringify(doc)))).toBe('object')
    expect((await load(doc)).notes).toEqual([])
  }
  test('49 runtimes besides the root save with the root and load; a 50th is refused live', async () => {
    const app = createApplication('app', { registry: registry() })
    reg(app, Pod.create(vault))
    for (let n = 0; n < 49; n++) ok(app.createRuntime(`r${n}`))
    expect(app.createRuntime('more')).toMatchObject(refused)
    await roundTrip(app)
  })
  test('2000 subscriptions in one runtime save and load; a 2001st is refused live', async () => {
    const app = createApplication('app', { registry: registry() })
    const v = reg(app, Pod.create(vault))
    for (let n = 0; n < 2000; n++) ok(app.subscribe({ kind: 'call', from: v, to: v }))
    expect(app.subscribe({ kind: 'call', from: v, to: v })).toMatchObject(refused)
    await roundTrip(app)
  })
  test('500 pods in one runtime save and load; a 501st is refused live', async () => {
    const app = createApplication('app', { registry: registry() })
    for (let n = 0; n < 500; n++) reg(app, Pod.create(vault))
    expect(app.register(Pod.create(vault))).toMatchObject(refused)
    await roundTrip(app)
  })
})

describe('checkDoc', () => {
  const good = { nano: 2 as const, title: 't', providers: [], pods: {}, runtimes: [], tags: {} }
  const rt = (x: object) => ({ ...good, runtimes: [{ id: 'r', pods: [], next: {}, subscriptions: [], ...x }] })

  test('refuses a document of more than 5000 pods, naming the count', () => {
    const many = (n: number) => ({ ...good, pods: Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { implementation: 'acme/keys/vault' }])) })
    expect(checkDoc(many(5001))).toContain('5001')
    expect(typeof checkDoc(many(5000))).toBe('object')
  })
  test('refuses a v1 document, or anything not an object, with a reason and without throwing', () => {
    expect(checkDoc({ nano: 1, title: 'Demo', imports: [], systems: [] })).toBe('not a nano v2 document')
    expect(checkDoc(null)).toBe('not a nano v2 document')
    expect(checkDoc('nano')).toBe('not a nano v2 document')
  })
  test('gives back a valid document', () => {
    expect(checkDoc(good)).toEqual(good)
  })
  test('names where a document is wrong', () => {
    expect(checkDoc(rt({ id: 'a/b' }))).toMatch(/^\/runtimes\/0\/id: /)
    expect(checkDoc({ ...good, runtimes: Array.from({ length: 51 }, (_, i) => ({ id: `r${i}`, pods: [], next: {}, subscriptions: [] })) })).toMatch(/^\/runtimes: /)
    expect(checkDoc({ ...good, pods: { p0: { implementation: 'nope' } } })).toMatch(/^\/pods\/p0\/implementation: /)
    expect(checkDoc(rt({ pods: [{ coord: 'v', pod: 'p0' }] }))).toMatch(/^\/runtimes\/0\/pods\/0\/coord: /)
    expect(checkDoc(rt({ pods: [{ coord: V, pod: 'a/b' }] }))).toMatch(/^\/runtimes\/0\/pods\/0\/pod: /)
    expect(checkDoc(rt({ next: { 'acme/keys/vault': 1.5 } }))).toMatch(/^\/runtimes\/0\/next/)
    expect(checkDoc(rt({ subscriptions: [{ id: 's', kind: 'call', from: 'a', to: V }] }))).toMatch(/^\/runtimes\/0\/subscriptions\/0/)
  })
  test('an application built through the public API saves a document checkDoc accepts, and it loads without notes', async () => {
    const app = setup()
    const r = ok(app.createRuntime('é'.repeat(64)))
    reg(r, Pod.create(vault, { config: { nested: [1, 'two', null, { three: true }] } }))
    reg(r, Pod.create(signer))
    ok(r.subscribe({ id: 'x'.repeat(64), kind: 'call', from: S, to: V }))
    const doc = saveDoc(app)
    expect(typeof checkDoc(JSON.parse(JSON.stringify(doc)))).toBe('object')
    const { app: back, notes } = await load(doc)
    expect(notes).toEqual([])
    expect(snapshot(back).runtimes).toEqual(snapshot(app).runtimes)
  })
})
