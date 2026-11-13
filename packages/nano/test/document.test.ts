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
const S = 'acme/keys/signer#s', V = 'acme/keys/vault#v', T = 'acme/ui/tester#t', W = 'acme/keys/vault#w', X = 'acme/keys/vault#x'
const spare: RuntimeDef = { id: 'spare', policy: 'allow-all', instances: [{ id: 'x', implementation: 'acme/keys/vault' }], members: [], subscriptions: [] }

/** Root holds `w`; `signer` holds the vault (with config) and the signer; `client` holds the tester, the signer placed in, and `w`; `spare` is only defined. */
async function setup() {
  const app = createApplication('app', { registry: registry() })
  const sr = app.createRuntime('signer'), cr = app.createRuntime('client')
  if (!sr.ok || !cr.ok) throw new Error('setup')
  await app.create('w', 'acme/keys/vault', { config: { root: true } })
  await sr.value.create('v', 'acme/keys/vault', { config: { slot: 1 } })
  await sr.value.create('s', 'acme/keys/signer', { provision: true })
  app.place(S, 'signer', 'client')
  app.place(W, 'app', 'client')
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
      own: rt.members().filter(c => rt.member(c)!.home === id).map(c => ({ c, config: rt.member(c)!.config })),
      placed: rt.members().filter(c => rt.member(c)!.home !== id).map(c => ({ c, home: rt.member(c)!.home })),
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
    expect(back.runtime('client')!.members()).toEqual([T, S, W]) // own instances first
    expect(back.runtime('client')!.status('s1')).toBe('live') // and 'late' (tester → a vault) stays broken, as it was
  })

  test('an opened runtime is saved from live: its own instances with config, placed members with their home, subscriptions in order', async () => {
    const doc = saveDoc(await setup())
    expect(doc.runtimes.find(r => r.id === 'client')).toEqual({
      id: 'client', policy: 'allow-all',
      instances: [{ id: 't', implementation: 'acme/ui/tester' }],
      members: [{ instance: S, home: 'signer' }, { instance: W, home: 'app' }],
      subscriptions: [{ id: 's1', kind: 'call', from: T, to: S }, { id: 'late', kind: 'call', from: T, to: W }],
    })
    expect(doc.runtimes.find(r => r.id === 'signer')!.instances).toEqual([
      { id: 'v', implementation: 'acme/keys/vault', config: { slot: 1 } },
      { id: 's', implementation: 'acme/keys/signer' },
    ])
  })

  test('the document lists the providers in use, the runtimes to open, and only coords with a tag', async () => {
    const doc = saveDoc(await setup(), { title: 'Signer', workspaces: [{ any: 'thing' }] })
    expect(doc).toMatchObject({ nano: 2, title: 'Signer', providers: ['acme/keys', 'acme/ui'], open: ['app', 'signer', 'client'], workspaces: [{ any: 'thing' }] })
    expect(doc.tags).toEqual({ [T]: ['ui'], [V]: ['keys', 'hot'], [X]: ['spare'] })
  })

  test('an unopened runtime is saved from its definition, unchanged', async () => {
    const doc = saveDoc(await setup())
    expect(doc.runtimes.find(r => r.id === 'spare')).toEqual(spare)
    expect(doc.open).not.toContain('spare')
  })

  test('the root is saved under the application id only when it has members or subscriptions', async () => {
    const app = createApplication('bare', { registry: registry() })
    app.createRuntime('r')
    expect(saveDoc(app).runtimes.map(r => r.id)).toEqual(['r'])
  })

  test('a root saved under another id loads as a child runtime, opened', async () => {
    const { app, notes } = await loadDoc(saveDoc(await setup()), { registry: registry(), id: 'other' })
    expect(notes).toEqual([])
    expect(app.runtime('app')!.members()).toEqual([W])
  })

  test('an adopted runtime is not saved', async () => {
    const app = createApplication('app', { registry: registry() })
    app.adopt(createRuntime('outside', { registry: registry() }))
    expect(saveDoc(app).runtimes).toEqual([])
  })

  test('a custom policy is not saved', async () => {
    const app = createApplication('app', { registry: registry() })
    app.createRuntime('strict', { policy: { isAllowed: () => ({ approved: true }) } })
    expect(saveDoc(app).runtimes).toEqual([{ id: 'strict', instances: [], members: [], subscriptions: [] }])
  })

  test('a subscription to a removed target is still saved, and waits after loading', async () => {
    const app = await setup()
    app.runtime('client')!.remove(S)
    expect(app.runtime('client')!.status('s1')).toBe('waiting')
    const doc = saveDoc(app)
    expect(doc.runtimes.find(r => r.id === 'client')!.subscriptions[0]).toEqual({ id: 's1', kind: 'call', from: T, to: S })
    const { app: back } = await load(doc)
    const client = back.runtime('client')!
    expect(client.status('s1')).toBe('waiting')
    expect(back.place(S, 'signer', 'client')).toEqual(success(undefined))
    expect(client.status('s1')).toBe('live')
  })

  test('an event subscription survives a round trip, live', async () => {
    const app = createApplication('app', { registry: registry() })
    const r = app.createRuntime('r')
    if (!r.ok) throw new Error('setup')
    await r.value.create('k', 'acme/keys/ticker'); await r.value.create('v', 'acme/keys/vault')
    const ev = { id: 'e', kind: 'event' as const, from: 'acme/keys/ticker#k', source: portKey(Ticks.coord, Ticks.ops.tick.coord), to: V, target: portKey(Vault.coord, Vault.ops.ping.coord) }
    expect(r.value.subscribe(ev).ok).toBe(true)
    expect(r.value.status('e')).toBe('live')
    const { app: back, notes } = await load(saveDoc(app))
    expect(notes).toEqual([])
    expect(snapshot(back)).toEqual(snapshot(app))
    expect(back.runtime('r')!.status('e')).toBe('live')
  })

  test('changing the saved document never changes a running or defined config', async () => {
    const app = await setup()
    app.define({ id: 'more', instances: [{ id: 'm', implementation: 'acme/keys/vault', config: { n: 1 } }], members: [], subscriptions: [] })
    const doc = saveDoc(app)
    ;(doc.runtimes.find(r => r.id === 'signer')!.instances[0]!.config as { slot: number }).slot = 9
    ;(doc.runtimes.find(r => r.id === 'more')!.instances[0]!.config as { n: number }).n = 9
    expect(app.runtime('signer')!.member(V)!.config).toEqual({ slot: 1 })
    expect(app.definition('more')!.instances[0]!.config).toEqual({ n: 1 })
  })

  test('only the runtimes in `open` are opened on load; the rest stay defined', async () => {
    const { app } = await load(saveDoc(await setup()))
    expect(app.runtime('spare')).toBeUndefined()
    expect(app.definition('spare')).toEqual(spare)
    expect((await app.open('spare')).ok).toBe(true)
  })
})

describe('loading what does not fit', () => {
  const doc = (runtimes: RuntimeDef[], extra: Partial<NanoDoc> = {}): NanoDoc =>
    ({ nano: 2, title: 't', providers: [], runtimes: runtimes.map(r => ({ policy: 'allow-all', ...r })), tags: {}, open: runtimes.map(r => r.id), ...extra })

  test('a runtime saved without a policy (a custom one) gives a note and loads with allow-all; a definition saves as allow-all', async () => {
    const app = createApplication('app', { registry: registry() })
    app.createRuntime('locked', { policy: { isAllowed: () => ({ approved: false, reason: 'no' }) } })
    app.define({ id: 'plain', instances: [], members: [], subscriptions: [] }) // a definition opens allow-all, so it saves as allow-all
    const { app: back, notes } = await load(saveDoc(app))
    expect(notes).toEqual(['locked: saved with a custom policy; loaded with allow-all'])
    expect(back.runtime('locked')!.policy.isAllowed(V, V, undefined)).toEqual({ approved: true })
  })

  test('a member whose home fails to open gives a note; the runtime opens without it', async () => {
    const v = { id: 'v', implementation: 'acme/keys/vault' }
    const { app, notes } = await load(doc([
      { id: 'a', instances: [v], members: [], subscriptions: [] },
      { id: 'h', instances: [v], members: [], subscriptions: [] }, // not defined: v is taken, so it cannot open
      { id: 'r', instances: [], members: [{ instance: V, home: 'h' }], subscriptions: [] },
    ]))
    expect(app.runtime('r')!.members()).toEqual([])
    expect(notes).toEqual(['h: instance id v is taken', `r: member ${V} skipped: no runtime h`])
  })

  test('an unknown implementation gives a note and the rest loads', async () => {
    const { app, notes } = await load(doc([{
      id: 'r', members: [], subscriptions: [{ id: 's1', kind: 'call', from: 'acme/nope/x#a', to: V }],
      instances: [{ id: 'a', implementation: 'acme/nope/x' }, { id: 'v', implementation: 'acme/keys/vault' }],
    }], { providers: ['acme/keys', 'acme/nope'] }))
    expect(notes).toEqual(['provider acme/nope is not registered', 'r/a: no implementation acme/nope/x'])
    expect(app.runtime('r')!.members()).toEqual([V])
    expect(app.runtime('r')!.status('s1')).toBe('waiting')
  })

  test('a member whose home is not in the document gives a note and is skipped', async () => {
    const { app, notes } = await load(doc([{ id: 'r', instances: [], members: [{ instance: S, home: 'gone' }], subscriptions: [] }]))
    expect(notes).toEqual(['r: member acme/keys/signer#s has no home gone'])
    expect(app.runtime('r')!.members()).toEqual([])
  })

  test('a member whose instance was skipped at its home gives the same note', async () => {
    const { notes } = await load(doc([
      { id: 'h', instances: [{ id: 'a', implementation: 'acme/nope/x' }], members: [], subscriptions: [] },
      { id: 'r', instances: [], members: [{ instance: 'acme/nope/x#a', home: 'h' }], subscriptions: [] },
    ]))
    expect(notes).toEqual(['h/a: no implementation acme/nope/x', 'r: member acme/nope/x#a has no home h'])
  })

  test('a subscription that cannot be added gives a note and the rest loads', async () => {
    const sub = { id: 's1', kind: 'call' as const, from: T, to: V }
    const { app, notes } = await load(doc([{ id: 'r', instances: [], members: [], subscriptions: [sub, sub] }]))
    expect(notes).toEqual(['r/s1: subscription s1 exists'])
    expect(app.runtime('r')!.subscriptions()).toEqual([sub])
  })

  test('a runtime that cannot be defined gives a note and the rest loads', async () => {
    const v = { id: 'v', implementation: 'acme/keys/vault' }
    const { app, notes } = await load(doc([
      { id: 'a', instances: [v], members: [], subscriptions: [] },
      { id: 'b', instances: [v], members: [], subscriptions: [] },
    ]))
    expect(notes).toEqual(['b: instance id v is taken'])
    expect(app.runtime('a')!.members()).toEqual([V])
  })

  test('a member repeated in one runtime gives a note, and the runtime opens with it once', async () => {
    const v = { id: 'v', implementation: 'acme/keys/vault' }
    const { app, notes } = await load(doc([
      { id: 'h', instances: [v], members: [], subscriptions: [] },
      { id: 'r', instances: [], members: [{ instance: V, home: 'h' }, { instance: V, home: 'h' }], subscriptions: [] },
    ]))
    expect(notes).toEqual([`r: member ${V} is repeated`])
    expect(app.runtime('r')!.members()).toEqual([V])
  })

  test('tags are applied only to what is held after loading', async () => {
    const { app } = await load(doc(
      [{ id: 'r', instances: [{ id: 'a', implementation: 'acme/nope/x' }, { id: 'v', implementation: 'acme/keys/vault' }], members: [], subscriptions: [] }],
      { tags: { 'acme/nope/x#a': ['lost'], [V]: ['kept'] } },
    ))
    expect([...app.tagsOf('acme/nope/x#a')]).toEqual([])
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
    const bad = { ...ok, runtimes: [{ id: 'a/b', instances: [], members: [], subscriptions: [] }] }
    expect(checkDoc(bad)).toMatch(/^\/runtimes\/0\/id: /)
  })

  test('checkDoc answers anything that is not an object with a reason, without throwing', () => {
    expect(checkDoc(null)).toBe('not a nano v2 document')
    expect(checkDoc('nano')).toBe('not a nano v2 document')
  })

  test('checkDoc refuses more than 50 runtimes', () => {
    expect(checkDoc({ ...ok, runtimes: Array.from({ length: 51 }, (_, i) => ({ id: `r${i}`, instances: [], members: [], subscriptions: [] })) }))
      .toMatch(/^\/runtimes: /)
  })

  test('member and subscription ends are instance coords', () => {
    const r = { id: 'r', instances: [], members: [{ instance: 'nope', home: 'h' }], subscriptions: [] }
    expect(checkDoc({ ...ok, runtimes: [r] })).toMatch(/^\/runtimes\/0\/members\/0\/instance: /)
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

  test('an instance id outside the id rule is refused', async () => {
    const rt = createRuntime('r', { registry: registry() })
    expect(await rt.create('a/b', 'acme/keys/vault')).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(await rt.create(long, 'acme/keys/vault')).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(rt.members()).toEqual([])
  })

  test('a subscription id outside the id rule is refused', () => {
    const rt = createRuntime('r', { registry: registry() })
    expect(rt.subscribe({ id: 'my sub', kind: 'call', from: T, to: V })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })

  test('a coord whose id is outside the id rule is not an instance coord', () => {
    const rt = createRuntime('r', { registry: registry() })
    expect(rt.subscribe({ kind: 'call', from: 'acme/ui/tester#a b', to: V })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })

  test('a config that is not JSON is refused', async () => {
    const rt = createRuntime('r', { registry: registry() })
    expect(await rt.create('v', 'acme/keys/vault', { config: { f: () => 1 } })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(await rt.create('v', 'acme/keys/vault', { config: new Date() })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  })

  test('define refuses a definition the document could not hold', () => {
    const app = createApplication('app', { registry: registry() })
    const def = (instances: RuntimeDef['instances']): RuntimeDef => ({ id: 'd', instances, members: [], subscriptions: [] })
    expect(app.define(def([{ id: 'a b', implementation: 'acme/keys/vault' }]))).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(app.define(def([{ id: 'a', implementation: 'acme/keys/vault', config: () => 1 }]))).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
    expect(app.definition('d')).toBeUndefined()
  })

  test('an application built through the public API saves a document checkDoc accepts, and it loads without notes', async () => {
    const app = await setup()
    const edge = 'é'.repeat(64)
    const r = app.createRuntime(edge)
    if (!r.ok) throw new Error('setup')
    await r.value.create('ü-1', 'acme/keys/vault', { config: { nested: [1, 'two', null, { three: true }] } })
    await r.value.create('s2', 'acme/keys/signer', { provision: true })
    r.value.subscribe({ id: 'x'.repeat(64), kind: 'call', from: 'acme/keys/signer#s2', to: 'acme/keys/vault#ü-1' })
    const doc = saveDoc(app)
    expect(typeof checkDoc(JSON.parse(JSON.stringify(doc)))).toBe('object')
    const { app: back, notes } = await load(doc)
    expect(notes).toEqual([])
    expect(snapshot(back).runtimes).toEqual(snapshot(app).runtimes)
  })
})
