// The React host's non-React logic: boot from the workspace's stored documents, the catalog, add and remove a slot.
import { expect, test } from 'bun:test'
import { Coord, Implementation, Pod, provide, success } from '@pritzlaff/nano-core'
import { log, MapIface } from '@pritzlaff/nano-ui'
import { boot } from '../src/boot.ts'
import { catalog } from '../src/catalog.ts'
import { addPage, addSlot, columnsOf, levels, removeSlot, setColumns, titleOf } from '../src/slots.ts'
import { KEYS } from '../src/stored.ts'

const acme = Coord.namespace('acme')
const shout = Implementation.define(acme.implementationId('shout'), { provides: [MapIface], make: () => [provide(MapIface, { map: async x => success(`${x}!`) })] })
const acmeModule = { default: acme.provider([shout]), views: { 'acme/shout': 'acme-shout' } }

const memory = (init: Record<string, unknown> = {}) => {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)]))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m } as unknown as Storage & { m: Map<string, string> }
}
const read = (s: Storage, k: string) => JSON.parse(s.getItem(k)!)
const stored = () => memory({
  [KEYS.app]: { pods: { log1: Pod.lazy(log) }, runtimes: { main: { pods: ['log1'], subscriptions: [] } }, modules: { 'nano.ui': '/bundle/nano-ui.js', acme: '/acme.js' }, views: {}, layout: { ring: { show: [] } } },
  [KEYS.pages]: { pages: { workspace: { slots: { log1: { kind: 'pod', pod: 'nano.ui/log@main/log1' } }, layout: { workspace: { resolved: true, root: { type: 'row' }, template: 'x' } }, title: 'Workspace', meta: { workspace: { order: 0, icon: 'home' } } } } },
})
const loads: string[] = []
const load = async (u: string) => { loads.push(u); if (u.endsWith('/acme.js')) return acmeModule; throw new Error(`no ${u}`) }
const started = async (s: Storage) => { const r = await boot(s, load); if (!r.ok) throw new Error(r.fail.reason); return r.value }

test('boots from the stored app document and Outline: same-origin modules loaded (nano.ui is the page\'s own), pages kept', async () => {
  const h = await started(stored())
  expect(loads).toEqual(['http://localhost:3000/acme.js'])
  expect(Object.keys(h.app.deployment().pods)).toEqual(['log1'])
  expect(h.app.runtime('main').status('log1')).toMatchObject({ ok: true, value: 'not started' })
  expect(JSON.parse(JSON.stringify(h.platform.document().doc.pages['workspace']!.slots))).toEqual({ log1: { kind: 'pod', pod: 'nano.ui/log@main/log1' } })
  expect(h.saved()).toMatchObject({ modules: { acme: '/acme.js' }, layout: { ring: { show: [] } } })
})

test('boots empty from empty storage; refuses a provider on another origin (out of scope)', async () => {
  const h = await started(memory())
  expect(h.platform.document().doc).toEqual({ roots: [], pages: {} })
  expect(addPage(h, 'First')).toMatchObject({ ok: true, value: 'first' })
  expect(await addSlot(h, 'first', 'nano.ui/log', 'main')).toMatchObject({ ok: true, value: 'log1' })   // an empty app can still place a pod
  const foreign = memory({ [KEYS.app]: { pods: {}, runtimes: {}, modules: { far: 'https://far.test/x.js' } } })
  expect(await boot(foreign, load)).toMatchObject({ ok: false })
})

test('the catalog: every implementation with its provider and view tag (nano.ui\'s and each module\'s)', async () => {
  const h = await started(stored()), c = catalog(h)
  expect(c.find(e => e.implementation === 'nano.ui/log')).toEqual({ implementation: 'nano.ui/log', provider: 'nano.ui', title: 'log', tag: 'nano-log' })
  expect(c.find(e => e.implementation === 'acme/shout')).toMatchObject({ provider: 'acme', tag: 'acme-shout' })
})

test('add slot: a lazy pod deployed into the chosen runtime, then its pod slot applied; nothing started; both saved', async () => {
  const s = stored(), h = await started(s)
  expect(await addSlot(h, 'workspace', 'nano.ui/log', 'side')).toMatchObject({ ok: true, value: 'log2' })
  expect(h.app.deployment().runtimes['side']!.pods).toEqual(['log2'])
  expect(h.app.runtime('side').status('log2')).toMatchObject({ ok: true, value: 'not started' })
  expect(String((h.platform.document().doc.pages['workspace']!.slots['log2'] as { pod: unknown }).pod)).toBe('nano.ui/log@side/log2')
  expect(await addSlot(h, 'workspace', 'nano.ui/map', 'main')).toMatchObject({ ok: true, value: 'map1' })
  expect(h.app.deployment().pods['map1']!.config).toEqual({ code: 'return x' })
  expect(read(s, KEYS.pages).pages.workspace.slots.map1).toEqual({ kind: 'pod', pod: 'nano.ui/map@main/map1' })
  expect(read(s, KEYS.app).pods.map1).toBeDefined()
  expect(read(s, KEYS.app).modules.acme).toBe('/acme.js')
  expect(read(s, KEYS.pages).pages.workspace.layout).toEqual({ workspace: { resolved: true, root: { type: 'row' }, template: 'x' } })   // the workspace's keys untouched
})

test('remove slot: the slot goes, the pod stays deployed, layout and meta kept', async () => {
  const s = stored(), h = await started(s)
  expect(removeSlot(h, 'workspace', 'log1')).toMatchObject({ ok: true })
  expect(read(s, KEYS.pages).pages.workspace).toEqual({ slots: {}, layout: { workspace: { resolved: true, root: { type: 'row' }, template: 'x' } }, title: 'Workspace', meta: { workspace: { order: 0, icon: 'home' } } })
  expect(h.app.deployment().pods['log1']).toBeDefined()
})

test('a new page: an id from its title, `title` only; columns go in layout.react beside the workspace\'s keys, on any page', async () => {
  const s = stored(), h = await started(s)
  expect(addPage(h, 'My Page!')).toMatchObject({ ok: true, value: 'my-page' })
  expect(addPage(h, 'My Page')).toMatchObject({ ok: true, value: 'my-page-2' })
  expect(read(s, KEYS.pages).pages['my-page']).toEqual({ slots: {}, title: 'My Page!' })
  expect(titleOf('my-page', h.platform.document().doc.pages['my-page'])).toBe('My Page!')
  expect(titleOf('workspace', h.platform.document().doc.pages['workspace'])).toBe('Workspace')
  expect(setColumns(h, 'workspace', 3)).toMatchObject({ ok: true })
  expect(read(s, KEYS.pages).pages.workspace.layout).toEqual({ workspace: { resolved: true, root: { type: 'row' }, template: 'x' }, react: { columns: 3 } })
  expect(read(s, KEYS.pages).pages.workspace.meta).toEqual({ workspace: { order: 0, icon: 'home' } })
  expect(columnsOf(h.platform.document().doc.pages['workspace'])).toBe(3)
  expect(setColumns(h, 'my-page', 4)).toMatchObject({ ok: true })   // a page the workspace has not arranged
  expect(read(s, KEYS.pages).pages['my-page'].layout).toEqual({ react: { columns: 4 } })
})

test('storage: the Outline key first, else the old platform key; only the Outline key is written; a write to either key in another tab stops saving', async () => {
  const pages = { roots: ['a'], pages: { a: { slots: {}, title: 'A' } } }
  const old = memory({ [KEYS.old]: pages }), h = await started(old)
  expect(Object.keys(h.platform.document().doc.pages)).toEqual(['a'])
  expect(addPage(h, 'B')).toMatchObject({ ok: true })
  expect(read(old, KEYS.pages).roots).toEqual(['a', 'b'])
  expect(read(old, KEYS.old)).toEqual(pages)   // the old key left as it was
  const both = memory({ [KEYS.old]: pages, [KEYS.pages]: { roots: ['z'], pages: { z: { slots: {} } } } })
  expect(Object.keys((await started(both)).platform.document().doc.pages)).toEqual(['z'])
})

test('tabs per level: the roots, then each page on the path to the shown page, its children; a child added under the shown page, a root with no parent', async () => {
  const h = await started(memory())
  addPage(h, 'Top'); addPage(h, 'Sub', 'top'); addPage(h, 'Deep', 'sub'); addPage(h, 'Other')
  const doc = () => h.platform.document().doc
  expect(doc().roots).toEqual(['top', 'other'])
  expect(doc().pages['top']!.children).toEqual(['sub'])
  expect(levels(doc(), 'deep')).toEqual([{ ids: ['top', 'other'], at: 'top' }, { ids: ['sub'], at: 'sub' }, { ids: ['deep'], at: 'deep' }])
  expect(levels(doc(), 'top')).toEqual([{ ids: ['top', 'other'], at: 'top' }, { ids: ['sub'], at: undefined }])
  expect(levels(doc(), 'other')).toEqual([{ ids: ['top', 'other'], at: 'other' }])
  expect(levels({ roots: [], pages: {} }, '')).toEqual([])
  expect(addPage(h, 'X', 'nope')).toMatchObject({ ok: false })
})
