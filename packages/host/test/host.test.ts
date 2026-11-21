// The host core's boot: the host document from one key or the old forms, the modules loaded beside the host's own
// providers, host pods placed but never saved, saving, and the another-tab guard.
import { expect, test } from 'bun:test'
import { failure, Implementation, Interface, Pod, Provider, provide } from '@pritzlaff/nano-core'
import { Host, type HostDocument } from '../src/index.ts'
import { views as acmeViews } from './acme.ts'

const KEY = 'nano-host.document', OLD = { app: 'nano-workspace.document', outline: 'nano-workspace.outline', platform: 'nano-workspace.platform' }
const Ui = Interface.define('own.Ui', {})
const ui = Implementation.define('own/ui', { provides: [Ui], make: async () => [provide(Ui, {})] })
const own = Provider.define('own', [ui])

type Mem = Storage & { m: Map<string, string> }
const memory = (init: Record<string, unknown> = {}, refuse?: 'writes' | 'all'): Mem => {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)]))
  const no = () => { throw new Error('quota exceeded') }
  return {
    m, getItem: (k: string) => (refuse === 'all' ? no() : m.get(k) ?? null),
    setItem: (k: string, v: string) => (refuse ? no() : void m.set(k, v)), removeItem: (k: string) => (refuse ? no() : void m.delete(k)),
  } as unknown as Mem
}
const strs = (v: unknown) => JSON.parse(JSON.stringify(v))
const base = import.meta.url
const boot = async (s: Storage, opts: Partial<Parameters<typeof Host.boot>[1]> = {}) => {
  const r = await Host.boot(s, { base, ...opts })
  if (!r.ok) throw new Error(r.fail.reason)
  return r.value
}

// One system in its old forms: the app document with the views and layout inside it, the pages as a tree or flat.
const system = { pods: { t1: { implementation: 'acme/thing', eager: false } }, runtimes: { main: { pods: ['t1'], subscriptions: [] } }, modules: { acme: './acme.ts' } }
const app = { ...system, views: { t1: 'acme-big' }, layout: { ring: { show: [] } } }
const page = { title: 'Home', slots: { t1: { kind: 'pod', pod: 'acme/thing@main/t1' } } }
const tree = { roots: ['home'], pages: { home: page } }
const expected: HostDocument = strs({ app: { ...system }, outline: tree, host: { views: app.views, layout: app.layout } })

test('every old form boots to the same HostDocument, saved under the one key, the old keys removed after that good save', async () => {
  const forms = {
    keys: memory({ [OLD.app]: app, [OLD.outline]: tree, [OLD.platform]: { pages: {} } }),   // the Outline's key wins over the platform's
    platform: memory({ [OLD.app]: app, [OLD.platform]: { pages: { home: page } } }),          // flat: every page a root
    inside: memory({ [KEY]: { app, outline: tree } }),                                       // the new key, views and layout still in the app
  }
  const hooked: string[] = []
  for (const [name, s] of Object.entries(forms)) {
    const h = await boot(s, { migrate: d => { hooked.push(name); return d } })
    expect(strs(h.document())).toEqual(expected)
    expect([...s.m.keys()]).toEqual([KEY])
    expect(JSON.parse(s.m.get(KEY)!)).toEqual(expected)
  }
  expect(hooked).toEqual(['keys', 'platform'])   // the host's hook sees the old forms only
})

test('the hook runs after loading, given the registry: it can name the loaded implementations', async () => {
  const s = memory({ [OLD.app]: system, [OLD.outline]: tree })
  let known: unknown
  const h = await boot(s, { providers: [own], migrate: (d, _s, registry) => { known = [registry.implementation('acme/thing')?.coord, registry.implementation('own/ui')?.coord]; return { ...d, host: { layout: { hooked: true } } } } })
  expect(known).toEqual(['acme/thing', 'own/ui'])
  expect(strs(h.document()).host).toEqual({ layout: { hooked: true } })
})

test('a view override for a pod that is gone is dropped at boot', async () => {
  const s = memory({ [KEY]: { app: system, outline: tree, host: { views: { t1: 'a', gone: 'b' } } } })
  expect(strs((await boot(s)).document()).host).toEqual({ views: { t1: 'a' } })
})

test('a second boot reads only the new key', async () => {
  const s = memory({ [OLD.app]: app, [OLD.outline]: tree })
  await boot(s, { migrate: d => d })
  s.m.set(OLD.app, JSON.stringify({ pods: {}, runtimes: {} })); s.m.set(OLD.outline, JSON.stringify({ roots: [], pages: {} }))
  const h = await boot(s, { migrate: d => d })   // the stale old keys are offered to the hook, not read over the one key
  expect(strs(h.document())).toEqual(expected)
})

test('storage that refuses writes: the old keys kept unchanged, and saving stops, said once', async () => {
  const s = memory({ [OLD.app]: app, [OLD.outline]: tree }, 'writes')
  let stops = 0
  const h = await boot(s, { migrate: d => d, onStop: () => stops++ })
  expect(h.stopped()).toMatch(/^not saved: quota exceeded/)
  expect([...s.m]).toEqual([[OLD.app, JSON.stringify(app)], [OLD.outline, JSON.stringify(tree)]])
  expect((await h.app.apply({ ...h.app.deployment(), pods: {}, runtimes: { main: { pods: [], subscriptions: [] } } })).ok).toBe(true)
  expect(stops).toBe(1)
})

test('storage that throws on every use: an empty document in memory, never a throw', async () => {
  const h = await boot(memory({}, 'all'))
  expect(strs(h.document())).toEqual({ app: { pods: {}, runtimes: {} }, outline: { roots: [], pages: {} } })
  expect(h.stopped()).toMatch(/^not saved/)
})

test('an unreadable stored document fails the boot and is kept as it was', async () => {
  const s = memory({ [KEY]: { app: { pods: 'no' }, outline: tree } })
  expect(await Host.boot(s, { base })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  s.m.set(OLD.outline, '{'); s.m.delete(KEY)
  expect(await Host.boot(s, { base })).toMatchObject({ ok: false })
  expect(s.m.get(OLD.outline)).toBe('{')
})

test('the another-tab guard: a write to the new key or an old one elsewhere stops saving', async () => {
  for (const key of [KEY, OLD.outline]) {
    const s = memory()
    let stops = 0
    const h = await boot(s, { migrate: d => d, onStop: () => stops++ })
    const saved = s.m.get(KEY)
    dispatchEvent(Object.assign(new Event('storage'), { key: 'unrelated' }))
    expect(h.stopped()).toBeUndefined()
    dispatchEvent(Object.assign(new Event('storage'), { key }))
    expect(h.stopped()).toMatch(/another tab/)
    expect(stops).toBe(1)
    h.setHost({ views: {} })
    expect(s.m.get(KEY)).toBe(saved!)
  }
})

test('exports: each loaded module\'s namespace; the host\'s own providers join the same registry, their modules not loaded', async () => {
  const s = memory({ [KEY]: { app: { ...system, modules: { acme: './acme.ts', own: './not-there.ts' } }, outline: tree } })
  const h = await boot(s, { providers: [own] })
  expect(h.exports['acme']!['views']).toEqual(acmeViews)
  expect(Object.keys(h.exports)).toEqual(['acme'])
  expect(h.registry.manifest().providers.map(p => p.coord)).toEqual(['acme', 'own'])
  expect(strs(h.document().app.modules)).toEqual({ acme: './acme.ts', own: './not-there.ts' })
  // the host's loader, when given, is the one asked
  const asked: Record<string, string>[] = []
  const r = await Host.boot(memory({ [KEY]: { app: system, outline: tree } }), { base, load: async m => { asked.push(m); return { ok: false, fail: { type: 'not-found', reason: 'refused' } } } })
  expect(r).toMatchObject({ ok: false, fail: { reason: 'refused' } })
  expect(asked).toEqual([{ acme: './acme.ts' }])
})

test('host pods: placed first in main, left out of document() and storage; a document naming one is refused', async () => {
  const empty = memory(), h = await boot(empty, { providers: [own], hostPods: { ui: Pod.lazy(ui) } })
  expect(h.app.deployment().runtimes['main']!.pods).toEqual(['ui'])
  expect(strs(h.document()).app).toEqual({ pods: {}, runtimes: {} })
  const s = memory({ [KEY]: { app: system, outline: tree } }), k = await boot(s, { providers: [own], hostPods: { ui: Pod.lazy(ui) } })
  expect(k.app.deployment().runtimes['main']!.pods).toEqual(['ui', 't1'])
  expect(strs(k.document()).app).toEqual({ ...system })
  expect(JSON.parse(s.m.get(KEY)!).app.pods.ui).toBeUndefined()
  const clash = memory({ [KEY]: { app: { ...system, pods: { ui: system.pods.t1 } }, outline: tree } })
  expect(await Host.boot(clash, { base, providers: [own], hostPods: { ui: Pod.lazy(ui) } })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
})

test('saving: on applied and on setHost; a view override for a pod that is gone is dropped', async () => {
  const s = memory({ [KEY]: { app: system, outline: tree, host: { views: { t1: 'acme-big' }, layout: { react: { columns: 2 } } } } }), h = await boot(s)
  h.setHost({ layout: { react: { columns: 3 } } })
  expect(JSON.parse(s.m.get(KEY)!).host).toEqual({ views: { t1: 'acme-big' }, layout: { react: { columns: 3 } } })
  expect((await h.app.apply({ ...h.app.deployment(), pods: {}, runtimes: { main: { pods: [], subscriptions: [] } } })).ok).toBe(true)
  expect(JSON.parse(s.m.get(KEY)!)).toMatchObject({ app: { pods: {} }, host: { views: {}, layout: { react: { columns: 3 } } } })
  expect(h.stopped()).toBeUndefined()
})

test('old keys read with no hook are kept, so a later boot with the hook migrates them', async () => {
  const s = memory({ [OLD.app]: { ...system, layout: { pages: ['old'] } } })
  const h = await boot(s)
  h.setHost({ views: { t1: 'x' } })
  expect([...s.m.keys()]).toEqual([OLD.app, KEY])
  const again = await boot(s, { migrate: d => ({ ...d, host: { layout: { migrated: true } } }) })
  expect(strs(again.document()).host).toEqual({ layout: { migrated: true } })
  expect([...s.m.keys()]).toEqual([KEY])
})

test('apply never records the host\'s own providers in modules', async () => {
  const h = await boot(memory({ [KEY]: { app: system, outline: tree } }), { providers: [own] })
  const r = await h.apply({ ...h.document().app, modules: { acme: './acme.ts', own: './not-there.ts' } })
  expect(r.ok).toBe(true)
  expect(strs(h.document().app.modules)).toEqual({ acme: './acme.ts' })
})

test('a save removes only the old keys that are present (a removal fires `storage` in other tabs)', async () => {
  const s = memory({ [OLD.app]: system, [OLD.outline]: tree }), removed: string[] = []
  const was = s.removeItem.bind(s); s.removeItem = (k: string) => { removed.push(k); was(k) }
  const h = await boot(s, { migrate: d => d })
  expect(removed.sort()).toEqual([OLD.app, OLD.outline])
  removed.length = 0; h.setHost({ views: {} })
  expect(removed).toEqual([])
})
