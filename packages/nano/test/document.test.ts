import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, type Interface } from '../src/iface.ts'
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
const vault = impl('acme/keys/vault', [Vault])
const signer = impl('acme/keys/signer', [Signer], { vault: Vault }, sign)
const tester = impl('acme/ui/tester', [], { signer: Signer })
const registry = () => {
  const r = createRegistry()
  r.add(provider('acme/keys', [vault, signer]))
  r.add(provider('acme/ui', [tester]))
  return r
}
const S = 'acme/keys/signer#s', V = 'acme/keys/vault#v', T = 'acme/ui/tester#t', W = 'acme/keys/vault#w', X = 'acme/keys/vault#x'
const spare: RuntimeDef = { id: 'spare', instances: [{ id: 'x', implementation: 'acme/keys/vault' }], members: [], subscriptions: [] }

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

  test('only the runtimes in `open` are opened on load; the rest stay defined', async () => {
    const { app } = await load(saveDoc(await setup()))
    expect(app.runtime('spare')).toBeUndefined()
    expect(app.definition('spare')).toEqual(spare)
    expect((await app.open('spare')).ok).toBe(true)
  })
})

describe('loading what does not fit', () => {
  const doc = (runtimes: RuntimeDef[], extra: Partial<NanoDoc> = {}): NanoDoc =>
    ({ nano: 2, title: 't', providers: [], runtimes, tags: {}, open: runtimes.map(r => r.id), ...extra })

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

  test('checkDoc names where a document is wrong, and never throws', () => {
    const bad = { ...ok, runtimes: [{ id: 'a/b', instances: [], members: [], subscriptions: [] }] }
    expect(checkDoc(bad)).toMatch(/^\/runtimes\/0\/id: /)
    expect(checkDoc(null)).toBe('not a nano v2 document')
    expect(checkDoc({ ...ok, runtimes: Array.from({ length: 51 }, (_, i) => ({ id: `r${i}`, instances: [], members: [], subscriptions: [] })) }))
      .toMatch(/^\/runtimes: /)
  })

  test('member and subscription ends are instance coords', () => {
    const r = { id: 'r', instances: [], members: [{ instance: 'nope', home: 'h' }], subscriptions: [] }
    expect(checkDoc({ ...ok, runtimes: [r] })).toMatch(/^\/runtimes\/0\/members\/0\/instance: /)
  })
})
