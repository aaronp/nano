import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, portKey, type Interface } from '../src/iface.ts'
import { success, type NanoResult } from '../src/result.ts'
import { implementation, provide, type Handler, type Implementation } from '../src/implementation.ts'
import { provider } from '../src/provider.ts'
import { createRegistry } from '../src/registry.ts'
import type { Selector } from '../src/selector.ts'
import { createApplication, type Application } from '../src/application.ts'
import { createRuntime } from '../src/runtime/index.ts'
import { checkDoc, loadDoc, saveDoc, type NanoDoc, type RuntimeDef } from '../src/document.ts'

const Str = defineSchema('Str', Type.String())
const face = (coord: string) => iface(coord, { ping: op.action('ping', Str, Str) })
const Vault = face('acme/vault'), Signer = face('acme/signer')
const echo: Handler = async (_c, s) => success(s)
const impl = (coord: string, provides: Interface[], dependencies: Record<string, Selector> = {}, ping: Handler = echo): Implementation =>
  implementation(coord, { provides, dependencies, make: async () => provides.map(i => provide(i, { ping })) })
const sign: Handler = async (ctx, s) => {
  const r: NanoResult<string> = await ctx.one(Vault, v => v.ping(s as string))
  return r.ok ? success(`signed ${r.value}`) : r
}
const Ticks = iface('acme/ticks', { tick: op.source('tick', Str) })
const vault = impl('acme/keys/vault', [Vault])
const ticker = impl('acme/keys/ticker', [Ticks])
const signer = impl('acme/keys/signer', [Signer], { vault: Vault }, sign)
const tester = impl('acme/ui/tester', [], { signer: Signer })
const registry = () => {
  const r = createRegistry()
  r.add(provider('acme/keys', [vault, signer, ticker]))
  r.add(provider('acme/ui', [tester]))
  return r
}
const S = 's#0', V = 'v#0', T = 't#0', W = 'w#0', X = 'x#0'
/** A saved pod with one instance, `<id>#0`. */
const one = (id: string, implementation: string, config?: unknown): RuntimeDef['pods'][number] => ({ id, implementation, ...(config !== undefined && { config }), instances: [0], next: 1 })
const spare: RuntimeDef = { id: 'spare', policy: 'allow-all', pods: [one('x', 'acme/keys/vault')], members: [], subscriptions: [] }

/** Root holds `w`; `signer` holds the vault (with config) and the signer; `client` holds the tester, the signer placed in, and `w`; `spare` is only defined. */
async function setup() {
  const app = createApplication('app', { registry: registry() })
  const sr = app.createRuntime('signer'), cr = app.createRuntime('client')
  if (!sr.ok || !cr.ok) throw new Error('setup')
  await app.create('w', 'acme/keys/vault', { config: { root: true } })
  await sr.value.create('v', 'acme/keys/vault', { config: { slot: 1 } })
  await sr.value.create('s', 'acme/keys/signer', { provision: true })
  app.place('s', 'signer', 'client')
  app.place('w', 'app', 'client')
  await cr.value.create('t', 'acme/ui/tester')
  cr.value.subscribe({ kind: 'call', from: T, to: S })
  cr.value.subscribe({ id: 'late', kind: 'call', from: T, to: W })
  app.define(spare)
  app.tag(T, 'ui'); app.tag(V, 'keys'); app.tag(V, 'hot'); app.tag(X, 'spare'); app.tag(S, 'gone'); app.untag(S, 'gone')
  return app
}

/**
 * Everything the round trip must keep: each runtime's own instances (create order, with config) and placed members
 * (placing order, with home), subscriptions in order with status, and tags. How the two kinds interleave is not kept:
 * on load a runtime's own instances come first (decision 37).
 */
function snapshot(app: Application) {
  const runtimes = [app.id, ...app.runtimes()].map(id => {
    const rt = app.runtime(id)
    if (!rt) return { id, definition: app.definition(id) }
    return {
      id,
      own: rt.pods().map(p => rt.pod(p)!).filter(p => p.home === id).map(p => ({ p: p.id, config: p.config })),
      placed: rt.pods().map(p => rt.pod(p)!).filter(p => p.home !== id).map(p => ({ p: p.id, home: p.home })),
      subscriptions: rt.subscriptions().map(s => ({ ...s, status: rt.status(s.id) })),
    }
  })
  const tags = Object.fromEntries([S, V, T, W, X].map(c => [c, [...app.tagsOf(c)]]))
  return { runtimes, tags }
}

const load = (doc: NanoDoc) => loadDoc(doc, { registry: registry() })

describe('saving and loading', () => {
  test('a round trip gives the same runtimes, members, subscriptions in order, and tags', async () => {
    const app = await setup()
    const doc = saveDoc(app, { title: 'Signer' })
    expect(checkDoc(JSON.parse(JSON.stringify(doc)))).toEqual(doc)
    const { app: back, notes } = await load(doc)
    expect(notes).toEqual([])
    expect(snapshot(back)).toEqual(snapshot(app))
    expect(back.runtime('client')!.instances()).toEqual([T, S, W]) // own instances first
    expect(back.runtime('client')!.status('s1')).toBe('live') // and 'late' (tester → a vault) stays broken, as it was
  })

  test('a started runtime is saved from live: its own pods with config and indices, placed members with their home, subscriptions in order', async () => {
    const doc = saveDoc(await setup())
    expect(doc.runtimes.find(r => r.id === 'client')).toEqual({
      id: 'client', policy: 'allow-all',
      pods: [one('t', 'acme/ui/tester')],
      members: [{ pod: 's', home: 'signer' }, { pod: 'w', home: 'app' }],
      subscriptions: [{ id: 's1', kind: 'call', from: T, to: S }, { id: 'late', kind: 'call', from: T, to: W }],
    })
    expect(doc.runtimes.find(r => r.id === 'signer')!.pods).toEqual([one('v', 'acme/keys/vault', { slot: 1 }), one('s', 'acme/keys/signer')])
  })

  test('the document lists the providers in use, the runtimes to start, and only coords with a tag', async () => {
    const doc = saveDoc(await setup(), { title: 'Signer', workspaces: [{ any: 'thing' }] })
    expect(doc).toMatchObject({ nano: 2, title: 'Signer', providers: ['acme/keys', 'acme/ui'], start: ['app', 'signer', 'client'], workspaces: [{ any: 'thing' }] })
    expect(doc.tags).toEqual({ [T]: ['ui'], [V]: ['keys', 'hot'], [X]: ['spare'] })
  })

  test('an unstarted runtime is saved from its definition, unchanged', async () => {
    const doc = saveDoc(await setup())
    expect(doc.runtimes.find(r => r.id === 'spare')).toEqual(spare)
    expect(doc.start).not.toContain('spare')
  })

  test('the root is saved under the application id only when it has members or subscriptions', async () => {
    const app = createApplication('bare', { registry: registry() })
    app.createRuntime('r')
    expect(saveDoc(app).runtimes.map(r => r.id)).toEqual(['r'])
  })

  test('a root saved under another id loads as a child runtime, started', async () => {
    const { app, notes } = await loadDoc(saveDoc(await setup()), { registry: registry(), id: 'other' })
    expect(notes).toEqual([])
    expect(app.runtime('app')!.instances()).toEqual([W])
  })

  test('an adopted runtime is not saved', async () => {
    const app = createApplication('app', { registry: registry() })
    app.adopt(createRuntime('outside', { registry: registry() }))
    expect(saveDoc(app).runtimes).toEqual([])
  })

  test('a custom policy is not saved', async () => {
    const app = createApplication('app', { registry: registry() })
    app.createRuntime('strict', { policy: { isAllowed: () => ({ approved: true }) } })
    expect(saveDoc(app).runtimes).toEqual([{ id: 'strict', pods: [], members: [], subscriptions: [] }])
  })

  test('a subscription to a removed target is deleted, so it is not saved', async () => {
    const app = await setup()
    app.runtime('client')!.remove('s')
    const rest = [{ id: 'late', kind: 'call' as const, from: T, to: W }]
    expect(app.runtime('client')!.subscriptions()).toEqual(rest)
    expect(saveDoc(app).runtimes.find(r => r.id === 'client')!.subscriptions).toEqual(rest)
  })

  // Plan Review Focus 4: indices are never reused across a save.
  test('given log#0 removed, when saved, loaded and an instance added, then it is log#1, never log#0', async () => {
    const app = createApplication('app', { registry: registry() })
    const r = app.createRuntime('r')
    if (!r.ok) throw new Error('setup')
    await r.value.create('log', 'acme/keys/vault')
    r.value.removeInstance('log#0')
    const doc = saveDoc(app)
    expect(doc.runtimes[0]!.pods).toEqual([{ id: 'log', implementation: 'acme/keys/vault', instances: [], next: 1 }])
    const { app: back, notes } = await load(doc)
    expect(notes).toEqual([])
    expect(back.runtime('r')!.pod('log')).toMatchObject({ count: 0, state: 'stopped' })
    expect(await back.runtime('r')!.addInstance('log')).toEqual(success('log#1'))
  })
  test('every instance of a pod survives a round trip with its index and its tags', async () => {
    const app = createApplication('app', { registry: registry() })
    const r = app.createRuntime('r')
    if (!r.ok) throw new Error('setup')
    await r.value.create('v', 'acme/keys/vault', { count: 3 })
    r.value.removeInstance('v#1')
    app.tag('v#0', 'a'); app.tag('v#2', 'b')
    const doc = saveDoc(app)
    expect(doc.tags).toEqual({ 'v#0': ['a'], 'v#2': ['b'] })
    const { app: back } = await load(doc)
    expect(back.runtime('r')!.instances()).toEqual(['v#0', 'v#2'])
    expect([...back.tagsOf('v#2')]).toEqual(['b'])
    expect(await back.runtime('r')!.addInstance('v')).toEqual(success('v#3'))
  })

  test('an event subscription survives a round trip, live', async () => {
    const app = createApplication('app', { registry: registry() })
    const r = app.createRuntime('r')
    if (!r.ok) throw new Error('setup')
    await r.value.create('k', 'acme/keys/ticker'); await r.value.create('v', 'acme/keys/vault')
    const ev = { id: 'e', kind: 'event' as const, from: 'k#0', source: portKey(Ticks.coord, Ticks.ops.tick.coord), to: V, target: portKey(Vault.coord, Vault.ops.ping.coord) }
    expect(r.value.subscribe(ev).ok).toBe(true)
    expect(r.value.status('e')).toBe('live')
    const { app: back, notes } = await load(saveDoc(app))
    expect(notes).toEqual([])
    expect(snapshot(back)).toEqual(snapshot(app))
    expect(back.runtime('r')!.status('e')).toBe('live')
  })

  test('changing the saved document never changes a running or defined config', async () => {
    const app = await setup()
    app.define({ id: 'more', pods: [one('m', 'acme/keys/vault', { n: 1 })], members: [], subscriptions: [] })
    const doc = saveDoc(app)
    ;(doc.runtimes.find(r => r.id === 'signer')!.pods[0]!.config as { slot: number }).slot = 9
    ;(doc.runtimes.find(r => r.id === 'more')!.pods[0]!.config as { n: number }).n = 9
    expect(app.runtime('signer')!.pod('v')!.config).toEqual({ slot: 1 })
    expect(app.definition('more')!.pods[0]!.config).toEqual({ n: 1 })
  })

  test('only the runtimes in `start` are started on load; the rest stay defined', async () => {
    const { app } = await load(saveDoc(await setup()))
    expect(app.runtime('spare')).toBeUndefined()
    expect(app.definition('spare')).toEqual(spare)
    expect((await app.start('spare')).ok).toBe(true)
  })
})

describe('loading what does not fit', () => {
  const doc = (runtimes: RuntimeDef[], extra: Partial<NanoDoc> = {}): NanoDoc =>
    ({ nano: 2, title: 't', providers: [], runtimes: runtimes.map(r => ({ policy: 'allow-all', ...r })), tags: {}, start: runtimes.map(r => r.id), ...extra })

  test('a runtime saved without a policy (a custom one) gives a note and loads with allow-all; a definition saves as allow-all', async () => {
    const app = createApplication('app', { registry: registry() })
    app.createRuntime('locked', { policy: { isAllowed: () => ({ approved: false, reason: 'no' }) } })
    app.define({ id: 'plain', pods: [], members: [], subscriptions: [] }) // a definition starts allow-all, so it saves as allow-all
    const { app: back, notes } = await load(saveDoc(app))
    expect(notes).toEqual(['locked: saved with a custom policy; loaded with allow-all'])
    expect(back.runtime('locked')!.policy.isAllowed(V, V, undefined)).toEqual({ approved: true })
  })

  test('a member whose home fails to open gives a note; the runtime opens without it', async () => {
    const v = one('v', 'acme/keys/vault')
    const { app, notes } = await load(doc([
      { id: 'a', pods: [v], members: [], subscriptions: [] },
      { id: 'h', pods: [v], members: [], subscriptions: [] }, // not defined: v is taken, so it cannot open
      { id: 'r', pods: [], members: [{ pod: 'v', home: 'h' }], subscriptions: [] },
    ]))
    expect(app.runtime('r')!.instances()).toEqual([])
    expect(notes).toEqual(['h: pod id v is taken', 'r: member v skipped: no runtime h'])
  })

  test('an unknown implementation gives a note and the rest loads', async () => {
    const { app, notes } = await load(doc([{
      id: 'r', members: [], subscriptions: [{ id: 's1', kind: 'call', from: 'a#0', to: V }],
      pods: [one('a', 'acme/nope/x'), one('v', 'acme/keys/vault')],
    }], { providers: ['acme/keys', 'acme/nope'] }))
    expect(notes).toEqual(['provider acme/nope is not registered', 'r/a: no implementation acme/nope/x'])
    expect(app.runtime('r')!.instances()).toEqual([V])
    expect(app.runtime('r')!.status('s1')).toBe('waiting')
  })

  test('a member whose home is not in the document gives a note and is skipped', async () => {
    const { app, notes } = await load(doc([{ id: 'r', pods: [], members: [{ pod: 's', home: 'gone' }], subscriptions: [] }]))
    expect(notes).toEqual(['r: member s has no home gone'])
    expect(app.runtime('r')!.instances()).toEqual([])
  })

  test('a member whose instance was skipped at its home gives the same note', async () => {
    const { notes } = await load(doc([
      { id: 'h', pods: [one('a', 'acme/nope/x')], members: [], subscriptions: [] },
      { id: 'r', pods: [], members: [{ pod: 'a', home: 'h' }], subscriptions: [] },
    ]))
    expect(notes).toEqual(['h/a: no implementation acme/nope/x', 'r: member a has no home h'])
  })

  test('a subscription that cannot be added gives a note and the rest loads', async () => {
    const sub = { id: 's1', kind: 'call' as const, from: T, to: V }
    const { app, notes } = await load(doc([{ id: 'r', pods: [], members: [], subscriptions: [sub, sub] }]))
    expect(notes).toEqual(['r/s1: subscription s1 exists'])
    expect(app.runtime('r')!.subscriptions()).toEqual([sub])
  })

  test('a runtime that cannot be defined gives a note and the rest loads', async () => {
    const v = one('v', 'acme/keys/vault')
    const { app, notes } = await load(doc([
      { id: 'a', pods: [v], members: [], subscriptions: [] },
      { id: 'b', pods: [v], members: [], subscriptions: [] },
    ]))
    expect(notes).toEqual(['b: pod id v is taken'])
    expect(app.runtime('a')!.instances()).toEqual([V])
  })

  test('a member repeated in one runtime gives a note, and the runtime opens with it once', async () => {
    const v = one('v', 'acme/keys/vault')
    const { app, notes } = await load(doc([
      { id: 'h', pods: [v], members: [], subscriptions: [] },
      { id: 'r', pods: [], members: [{ pod: 'v', home: 'h' }, { pod: 'v', home: 'h' }], subscriptions: [] },
    ]))
    expect(notes).toEqual(['r: member v is repeated'])
    expect(app.runtime('r')!.instances()).toEqual([V])
  })

  test('tags are applied only to what is held after loading', async () => {
    const { app } = await load(doc(
      [{ id: 'r', pods: [one('a', 'acme/nope/x'), one('v', 'acme/keys/vault')], members: [], subscriptions: [] }],
      { tags: { 'a#0': ['lost'], [V]: ['kept'] } },
    ))
    expect([...app.tagsOf('a#0')]).toEqual([])
    expect([...app.tagsOf(V)]).toEqual(['kept'])
  })

  test('an invalid document gives its reason as a note and an empty application', async () => {
    const { app, notes } = await load({ nano: 1 } as unknown as NanoDoc)
    expect(notes).toEqual(['not a nano v2 document'])
    expect(app.runtimes()).toEqual([])
  })
})

describe('checkDoc', () => {
  const ok = { nano: 2 as const, title: 't', providers: [], runtimes: [], tags: {} }

  test('checkDoc refuses a v1 document with a reason', () => {
    expect(checkDoc({ nano: 1, title: 'Demo', imports: [], systems: [] })).toBe('not a nano v2 document')
  })

  test('checkDoc gives back a valid document', () => {
    expect(checkDoc(ok)).toEqual(ok)
  })

  test('checkDoc names where a document is wrong', () => {
    const bad = { ...ok, runtimes: [{ id: 'a/b', pods: [], members: [], subscriptions: [] }] }
    expect(checkDoc(bad)).toMatch(/^\/runtimes\/0\/id: /)
  })

  test('checkDoc answers anything that is not an object with a reason, without throwing', () => {
    expect(checkDoc(null)).toBe('not a nano v2 document')
    expect(checkDoc('nano')).toBe('not a nano v2 document')
  })

  test('checkDoc refuses more than 50 runtimes', () => {
    expect(checkDoc({ ...ok, runtimes: Array.from({ length: 51 }, (_, i) => ({ id: `r${i}`, pods: [], members: [], subscriptions: [] })) }))
      .toMatch(/^\/runtimes: /)
  })

  test('members name a pod id; subscription ends are instance coords', () => {
    const r = (members: unknown[], subscriptions: unknown[]) => ({ id: 'r', pods: [], members, subscriptions })
    expect(checkDoc({ ...ok, runtimes: [r([{ pod: 'a/b', home: 'h' }], [])] })).toMatch(/^\/runtimes\/0\/members\/0\/pod: /)
    expect(checkDoc({ ...ok, runtimes: [r([], [{ id: 's', kind: 'call', from: 'a', to: 'b#0' }])] })).toMatch(/^\/runtimes\/0\/subscriptions\/0/)
  })
  test('a pod saves its instance indices and next', () => {
    const pod = (p: object) => ({ ...ok, runtimes: [{ id: 'r', pods: [{ id: 'v', implementation: 'acme/keys/vault', instances: [0], next: 1, ...p }], members: [], subscriptions: [] }] })
    expect(typeof checkDoc(pod({}))).toBe('object')
    expect(checkDoc(pod({ instances: [1.5] }))).toMatch(/^\/runtimes\/0\/pods\/0\/instances\/0: /)
    expect(checkDoc(pod({ next: undefined }))).toMatch(/^\/runtimes\/0\/pods\/0/)
  })
})

describe('only what the document can hold is made', () => {
  const long = 'x'.repeat(65)

  test('a runtime id outside the id rule is refused', () => {
    const app = createApplication('app', { registry: registry() })
    expect(app.createRuntime('my runtime')).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(app.createRuntime(long)).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(() => createRuntime('my runtime', { registry: registry() })).toThrow('bad runtime id')
  })

  test('a pod id outside the id rule is refused', async () => {
    const rt = createRuntime('r', { registry: registry() })
    expect(await rt.create('a/b', 'acme/keys/vault')).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(await rt.create(long, 'acme/keys/vault')).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(rt.instances()).toEqual([])
  })

  test('a subscription id outside the id rule is refused', () => {
    const rt = createRuntime('r', { registry: registry() })
    expect(rt.subscribe({ id: 'my sub', kind: 'call', from: T, to: V })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })

  test('a coord whose id is outside the id rule is not an instance coord', () => {
    const rt = createRuntime('r', { registry: registry() })
    expect(rt.subscribe({ kind: 'call', from: 'a b#0', to: V })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })

  test('a config that is not JSON is refused', async () => {
    const rt = createRuntime('r', { registry: registry() })
    expect(await rt.create('v', 'acme/keys/vault', { config: { f: () => 1 } })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(await rt.create('v', 'acme/keys/vault', { config: new Date() })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })

  test('define refuses a definition the document could not hold', () => {
    const app = createApplication('app', { registry: registry() })
    const def = (pods: RuntimeDef['pods']): RuntimeDef => ({ id: 'd', pods, members: [], subscriptions: [] })
    expect(app.define(def([one('a b', 'acme/keys/vault')]))).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(app.define(def([one('a', 'acme/keys/vault', () => 1)]))).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(app.definition('d')).toBeUndefined()
  })

  test('an application built through the public API saves a document checkDoc accepts, and it loads without notes', async () => {
    const app = await setup()
    const edge = 'é'.repeat(64)
    const r = app.createRuntime(edge)
    if (!r.ok) throw new Error('setup')
    await r.value.create('ü-1', 'acme/keys/vault', { config: { nested: [1, 'two', null, { three: true }] } })
    await r.value.create('s2', 'acme/keys/signer', { provision: true })
    r.value.subscribe({ id: 'x'.repeat(64), kind: 'call', from: 's2#0', to: 'ü-1#0' })
    const doc = saveDoc(app)
    expect(typeof checkDoc(JSON.parse(JSON.stringify(doc)))).toBe('object')
    const { app: back, notes } = await load(doc)
    expect(notes).toEqual([])
    expect(snapshot(back).runtimes).toEqual(snapshot(app).runtimes)
  })
})
