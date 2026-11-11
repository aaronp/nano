import { expect, test } from 'bun:test'
import { Ops } from '@pritzlaff/nano-core'
import { Log, Range, Map as MapC } from '@composable/bundle'
import { PlatformOps as P, runtimeOf } from '@composable/platform'
import type { NanoApp } from '@composable/shell'
import { applyApp } from '../src/app/apply'
import { snapshotApp } from '../src/app/snapshot'
import { appHost, memoryStores, Profile, tick } from './fixtures/app-host'

const doc: NanoApp = {
  nano: 1, title: 'Doc', theme: { id: 'terminal', mode: 'dark' },
  profile: { user: { name: 'Ada' }, entries: [{ label: 'Home', href: '#/' }] },
  imports: [{ url: 'https://x.test/m.json', trust: 'sandboxed' }],
  systems: [{
    id: 'lab',
    instances: [
      { id: 'r1', kind: 'range', mode: 'host', allow: ['host/log/*'], deny: ['host/platform/*'], config: { min: 0, max: 10, step: 0.5, value: 4 } },
      { id: 'm1', kind: 'map', mode: 'host', config: { code: 'return x * 2' } },
      { id: 'b1', kind: 'boxed', mode: 'isolated-sandbox' },
    ],
    subscriptions: [{ source: 'r1', op: Ops.key(Range.ops.value), listener: 'm1', target: Ops.key(MapC.ops.map) }],
  }],
  workspaces: [{ id: '/lab', title: 'Lab', system: 'lab', icon: 'rocket', layout: { root: 1 } }],
}
const fresh = async (init = {}) => {
  const h = appHost(), s = memoryStores(init)
  await h.call('platform', P.createComponent, { kind: 'profile', name: 'profile', system: 'host' })
  const imported: string[] = []
  const deps = { host: h.host, stores: s.stores, catalog: h.catalog, consentCode: () => true, importPackage: async (url: string) => { imported.push(url); return {} } }
  return { ...h, ...s, imported, deps }
}

test('apply(replace) of a snapshot onto a fresh host reproduces it', async () => {
  const a = await fresh()
  expect(await applyApp(doc, 'replace', a.deps)).toEqual([])
  await tick()
  expect(a.imported).toEqual(['https://x.test/m.json'])
  const first = await snapshotApp({ host: a.host, stores: a.stores })
  expect(first).toEqual(doc)
  const b = await fresh()
  expect(await applyApp(first, 'replace', b.deps)).toEqual([])
  await tick()
  expect(await snapshotApp({ host: b.host, stores: b.stores })).toEqual(first)
  expect(b.st.title).toBe('Doc')
}, 10_000)

test('apply(merge) adds only new ids and returns clash notes; leaves title/theme/profile', async () => {
  const a = await fresh({ title: 'Mine' })
  await applyApp({ ...doc, systems: [{ id: 'lab', instances: [{ id: 'r1', kind: 'range' }], subscriptions: [] }] }, 'replace', a.deps)
  a.st.title = 'Mine'; a.st.theme = { theme: 'enterprise', mode: 'light' }
  await a.call('profile', Profile.ops.setUser, { name: 'Me' })
  const notes = await applyApp(doc, 'merge', a.deps)
  expect(notes.some(n => n.includes('lab/r1') && n.includes('already exists'))).toBe(true)
  expect(notes.some(n => n.includes('workspace /lab already exists'))).toBe(true)
  const app = await snapshotApp({ host: a.host, stores: a.stores })
  expect(app.title).toBe('Mine'); expect(app.theme).toEqual({ id: 'enterprise', mode: 'light' }); expect(app.profile?.user.name).toBe('Me')
  expect(app.systems[0]!.instances.map(i => i.id).sort()).toEqual(['b1', 'm1', 'r1'])
  expect(app.systems[0]!.instances.find(i => i.id === 'r1')!.config).toMatchObject({ max: 100 })   // the existing r1 is untouched
  expect(app.systems[0]!.subscriptions).toHaveLength(1)
  expect(app.workspaces).toHaveLength(1)
}, 10_000)

test('unknown kinds and subscriptions with missing ends are skipped with notes', async () => {
  const a = await fresh()
  const notes = await applyApp({ ...doc, systems: [{ id: 'lab', instances: [{ id: 'x', kind: 'nope' }, { id: 'y', kind: '__proto__' }, { id: 'r1', kind: 'range' }],
    subscriptions: [{ source: 'r1', op: 'a/b/c', listener: 'ghost', target: 'a/b/d' }] }], workspaces: [] }, 'replace', a.deps)
  expect(notes).toEqual(expect.arrayContaining([expect.stringContaining('no component kind nope'), expect.stringContaining('no component kind __proto__'), expect.stringContaining('ghost is not there')]))
  expect(runtimeOf(a.host.registry, 'lab')!.registry.get('r1')).toBeDefined()
})

test('reserved ids are skipped', async () => {
  const a = await fresh()
  const notes = await applyApp({ ...doc, workspaces: [], systems: [{ id: 'host', instances: [{ id: 'platform', kind: 'log' }, { id: 'ex-new', kind: 'log' }, { id: 'ok', kind: 'log' }], subscriptions: [] }] }, 'replace', a.deps)
  expect(notes.filter(n => n.includes('reserved'))).toHaveLength(2)
  expect(a.host.registry.get('ex-new')).toBeUndefined()
  expect(a.host.registry.get('ok')).toBeDefined()
})

test('a kind imported sandboxed but asked host/sandbox is deployed isolated-sandbox, with a note', async () => {
  const a = await fresh()
  const notes = await applyApp({ ...doc, workspaces: [], systems: [{ id: 'host', instances: [{ id: 'b1', kind: 'boxed', mode: 'host' }, { id: 'b2', kind: 'boxed', mode: 'sandbox' }], subscriptions: [] }] }, 'replace', a.deps)
  expect(a.deployed.filter(d => d.id.startsWith('b'))).toEqual([{ id: 'b1', mode: 'isolated-sandbox' }, { id: 'b2', mode: 'isolated-sandbox' }])
  expect(notes.filter(n => n.includes('isolated-sandbox instead of'))).toHaveLength(2)
}, 10_000)

test('a throwing configure is a note; the instance stays', async () => {
  const a = await fresh()
  const notes = await applyApp({ ...doc, workspaces: [], systems: [{ id: 'host', instances: [{ id: 'r1', kind: 'range', config: { min: 5, max: 1, step: 1, value: 2 } }], subscriptions: [] }] }, 'replace', a.deps)
  expect(notes).toEqual([expect.stringContaining('host/r1 configure')])
  expect(a.host.registry.get('r1')).toBeDefined()
})

test('a code config (map, filter) is applied only with consent; the instance is created either way', async () => {
  const a = await fresh()
  const d = { ...doc, workspaces: [], systems: [{ id: 'host', instances: [{ id: 'm1', kind: 'map', config: { code: 'return 1' } }, { id: 'm2', kind: 'map', config: { code: 'return 2' } }], subscriptions: [] }] }
  const notes = await applyApp(d, 'replace', { ...a.deps, consentCode: (_s, i) => i === 'm2' })
  expect(notes).toEqual([expect.stringContaining('host/m1: its map code was not applied')])
  expect((await a.call('m1', MapC.ops.code)).value).toBe('return x')
  expect((await a.call('m2', MapC.ops.code)).value).toBe('return 2')
  const b = await fresh()   // by default a document's code is not run
  await applyApp(d, 'replace', { host: b.host, stores: b.stores, catalog: b.catalog, importPackage: async () => ({}) })
  expect((await b.call('m2', MapC.ops.code)).value).toBe('return x')
})

test('a failed import is a note, its kinds are skipped, the rest loads; an unknown theme is a note', async () => {
  const a = await fresh()
  const notes = await applyApp({ ...doc, theme: { id: 'nope' }, systems: [{ id: 'host', instances: [{ id: 'q', kind: 'quux' }, { id: 'l', kind: 'log' }], subscriptions: [] }] }, 'replace',
    { ...a.deps, importPackage: async () => ({ error: 'offline' }) })
  expect(notes).toEqual(expect.arrayContaining([expect.stringContaining('offline'), expect.stringContaining('unknown theme nope'), expect.stringContaining('no component kind quux')]))
  expect(a.st.theme.theme).toBe('enterprise'); expect(a.host.registry.get('l')).toBeDefined(); expect(a.st.imports).toEqual([])
})

const sys = (instances: NanoApp['systems'][number]['instances'], subscriptions: NanoApp['systems'][number]['subscriptions'] = []): NanoApp => ({ ...doc, imports: [], workspaces: [], systems: [{ id: 'host', instances, subscriptions }] })

test('a configure on a sandbox frame that never answers is a note, and apply finishes', async () => {
  const a = await fresh()
  const t = Date.now()
  const notes = await applyApp(sys([{ id: 'b1', kind: 'boxed', mode: 'isolated-sandbox', config: {} }, { id: 'l', kind: 'log' }]), 'replace', { ...a.deps, waits: { configure: 50 } })
  expect(notes).toEqual([expect.stringContaining('host/b1 configure: configure timed out')])
  expect(Date.now() - t).toBeLessThan(2000)
  expect(a.host.registry.get('l')).toBeDefined()
}, 3000)

test('an import that never answers or rejects is a note', async () => {
  const a = await fresh()
  const hang = await applyApp({ ...doc, systems: [], workspaces: [] }, 'replace', { ...a.deps, importPackage: () => new Promise(() => {}), waits: { import: 50 } })
  expect(hang).toEqual([expect.stringContaining('timed out')])
  const rej = await applyApp({ ...doc, systems: [], workspaces: [] }, 'replace', { ...a.deps, importPackage: async () => { throw new Error('boom') } })
  expect(rej).toEqual([expect.stringContaining('boom')])
}, 3000)

const feed = [{ id: 'm0', kind: 'map' as const }, { id: 'm1', kind: 'map' as const, mode: 'host' as const }]
const into = (op: { ns: string; name: string }) => [{ source: 'm0', op: Ops.key(op === MapC.ops.setCode ? MapC.ops.code : MapC.ops.config), listener: 'm1', target: Ops.key(op) }]

test('a subscription into setCode/configure of a code kind needs consent, in a new system and in a merge', async () => {
  const a = await fresh()
  for (const op of [MapC.ops.setCode, MapC.ops.configure]) {
    const rt = () => a.host.registry.snapshot().subscriptions.filter(s => s.target === Ops.key(op))
    const notes = await applyApp(sys(feed, into(op)), 'replace', { ...a.deps, consentCode: () => false })
    expect(notes.some(n => n.includes('feeds code'))).toBe(true)
    expect(rt()).toHaveLength(0)
    await applyApp(sys([], into(op)), 'merge', { ...a.deps, consentCode: () => false })   // into the existing m1
    expect(rt()).toHaveLength(0)
    expect(await applyApp(sys([], into(op)), 'merge', { ...a.deps, consentCode: (_s, i) => i === 'm1' })).toEqual([])
    expect(rt()).toHaveLength(1)
    a.host.registry.unsubscribe(rt()[0]!.id)
  }
})

test('a "*" source subscription round-trips', async () => {
  const a = await fresh()
  await applyApp(sys([{ id: 'l1', kind: 'log' }]), 'replace', a.deps)
  a.host.registry.subscribe({ source: '*', op: Ops.key(Range.ops.value), listener: 'l1', target: 'composable.bundle/log/info' })
  const snap = await snapshotApp({ host: a.host, stores: a.stores })
  expect(snap.systems[0]!.subscriptions).toHaveLength(1)
  const b = await fresh()
  expect(await applyApp(snap, 'replace', b.deps)).toEqual([])
  expect(await snapshotApp({ host: b.host, stores: b.stores })).toEqual(snap)
})

test('applyApp always resolves: a throwing consent, throwing stores and a throwing host become notes', async () => {
  const a = await fresh()
  const boom = () => { throw new Error('quota') }
  const stores = { ...a.stores, title: { get: () => '', set: boom }, theme: { get: () => ({ theme: 'enterprise', mode: 'system' }) as never, set: boom }, imports: { list: () => [], set: boom }, workspaces: { list: () => [], set: boom }, layouts: { get: () => null, set: boom } }
  const notes = await applyApp(doc, 'replace', { ...a.deps, stores, consentCode: boom })
  for (const w of ['title', 'theme', 'imports', 'workspaces', 'layout of /lab']) expect(notes.some(n => n.startsWith(w + ': quota'))).toBe(true)
  expect(notes.some(n => n.includes('m1') && n.includes('not agreed'))).toBe(true)   // consent that throws is no consent
  const dead = await applyApp(doc, 'replace', { ...a.deps, host: { ...a.host, call: () => { throw new Error('gone') } } as never })
  expect(Array.isArray(dead)).toBe(true)
})

test('the saved workspaces order round-trips through snapshot and apply', async () => {
  const ws = (id: string) => ({ id, title: id, system: 'host', icon: 'box', layout: null })
  const d = { ...doc, workspaces: [ws('/c'), ws('/a'), ws('/b')] }
  const a = await fresh()
  expect(await applyApp(d, 'replace', a.deps)).toEqual([])
  expect(a.st.workspaces.map((w: any) => w.path)).toEqual(['/c', '/a', '/b'])
  const { savedWorkspaces } = await import('../src/lib/saved-workspaces.ts')
  const mem = { v: JSON.stringify(a.st.workspaces), getItem() { return this.v }, setItem(_: string, v: string) { this.v = v } }
  savedWorkspaces(mem).move('/c', 1)
  a.st.workspaces = savedWorkspaces(mem).list()
  expect((await snapshotApp({ host: a.host, stores: a.stores })).workspaces.map(w => w.id)).toEqual(['/a', '/c', '/b'])
  const b = await fresh()
  await applyApp(await snapshotApp({ host: a.host, stores: a.stores }), 'replace', b.deps)
  expect(b.st.workspaces.map((w: any) => w.path)).toEqual(['/a', '/c', '/b'])
}, 10_000)

test("the platform and a built-in's code op are never wired, even with consent; a built-in's other ops are", async () => {
  const a = await fresh()
  for (const [kind, name] of [['map', 'ex-map'], ['log', 'ex-log']]) await a.call('platform', P.createComponent, { kind, name, system: 'host' })
  const notes = await applyApp(sys([{ id: 'm0', kind: 'map' }], [
    { source: 'm0', op: Ops.key(MapC.ops.mapped), listener: 'ex-map', target: Ops.key(MapC.ops.setCode) },
    { source: 'm0', op: Ops.key(MapC.ops.mapped), listener: 'ex-log', target: Ops.key(Log.ops.info) },
    { source: 'm0', op: Ops.key(MapC.ops.mapped), listener: 'platform', target: Ops.key(P.connect) },
  ]), 'replace', a.deps)
  expect(notes).toHaveLength(2)
  expect(notes.every(n => n.includes('reserved'))).toBe(true)
  const wired = a.host.registry.snapshot().subscriptions.filter(s => s.source === 'm0').map(s => s.listener).sort()
  expect(wired).toEqual(['ex-log'])
})

test('configures that never answer run together under one bound', async () => {
  const a = await fresh()
  const t = Date.now()
  const hung = (id: string) => ({ id, kind: 'boxed', mode: 'isolated-sandbox' as const, config: {} })
  const notes = await applyApp(sys([hung('b1'), hung('b2'), hung('b3'), hung('b4')]), 'replace', { ...a.deps, waits: { configure: 300 } })
  expect(notes).toHaveLength(4)
  expect(Date.now() - t).toBeLessThan(700)
}, 3000)

test('a throwing "*"-source subscribe is that step\'s note', async () => {
  const a = await fresh()
  const rt = a.host.registry as any, orig = rt.subscribe.bind(rt)
  rt.subscribe = () => { throw new Error('nope') }
  const notes = await applyApp(sys([{ id: 'l', kind: 'log' }], [{ source: '*', op: 'x/y', listener: 'l', target: Ops.key(Log.ops.info) }]), 'replace', a.deps)
  rt.subscribe = orig
  expect(notes).toEqual([expect.stringContaining('-> l')])
  expect(notes[0]).not.toContain('stopped')
})
