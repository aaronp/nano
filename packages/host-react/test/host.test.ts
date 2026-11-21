// The React host's non-React logic on the host core: boot (nano.ui its own, same-origin modules only), the views and
// the catalog, a pick into a chosen runtime, remove a slot, new pages, columns, tabs per level. Storage, migration and
// the pick's details are the host core's (packages/host/test).
import { expect, test } from 'bun:test'
import { Coord, failure, Implementation, Pod, provide, Registry, success } from '@pritzlaff/nano-core'
import { log, MapIface, viewFor } from '@pritzlaff/nano-ui'
import { removeSlot } from '@pritzlaff/nano-host'
import { boot, viewsOf } from '../src/boot.ts'
import { catalog } from '../src/catalog.ts'
import { columnsOf, edit, levels, newPage, setColumns, titleOf } from '../src/pages.ts'

const KEY = 'nano-host.document', OLD = 'nano-workspace.document', OLD_OUTLINE = 'nano-workspace.outline'
const acme = Coord.namespace('acme')
const shout = Implementation.define(acme.implementationId('shout'), { provides: [MapIface], make: () => [provide(MapIface, { map: async x => success(`${x}!`) })] })
const acmeModule = { default: acme.provider([shout]), views: { 'acme/shout': 'acme-shout' } }

const memory = (init: Record<string, unknown> = {}) => {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)]))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m } as unknown as Storage & { m: Map<string, string> }
}
const read = (s: Storage) => JSON.parse(s.getItem(KEY)!)
const wsLayout = { workspace: { resolved: true, root: { type: 'row' }, template: 'x' } }
const stored = () => memory({
  [OLD]: { pods: { log1: Pod.lazy(log) }, runtimes: { main: { pods: ['log1'], subscriptions: [] } }, modules: { 'nano.ui': '/bundle/nano-ui.js', acme: '/acme.js' }, views: { log1: 'my-log' }, layout: { ring: { show: [] } } },
  [OLD_OUTLINE]: { pages: { workspace: { slots: { log1: { kind: 'pod', pod: 'nano.ui/log@main/log1' } }, layout: wsLayout, title: 'Workspace', meta: { workspace: { order: 0, icon: 'home' } } } } },
})
const loads: string[] = []
/** Core's loader, with acme.js the only module there is. */
const load: typeof Registry.load = async (modules, base) => {
  const registry = Registry.create(), exports: Record<string, Record<string, unknown>> = {}
  for (const [k, ref] of Object.entries(modules)) {
    loads.push(new URL(ref, base).href)
    if (!ref.endsWith('/acme.js')) return failure('not-found', `no ${ref}`)
    registry.add(acmeModule.default); exports[k] = acmeModule
  }
  return success({ registry, exports })
}
customElements.define('my-log', class extends HTMLElement {})
const started = async (s: Storage) => { const r = await boot(s, { load }); if (!r.ok) throw new Error(r.fail.reason); return r.value }

test('boots from the workspace\'s old keys: same-origin modules loaded (nano.ui is the page\'s own), pages kept, saved under the one key', async () => {
  loads.length = 0
  const s = stored(), h = await started(s)
  expect(loads).toEqual(['http://localhost:3000/acme.js'])
  expect(h.app.runtime('main').status('log1')).toMatchObject({ ok: true, value: 'not started' })
  expect(JSON.parse(JSON.stringify(h.outline.document().doc.pages['workspace']!.slots))).toEqual({ log1: { kind: 'pod', pod: 'nano.ui/log@main/log1' } })
  expect(read(s)).toMatchObject({ app: { modules: { acme: '/acme.js' } }, host: { views: { log1: 'my-log' }, layout: { ring: { show: [] } } } })
})

test('refuses a provider on another origin; boots empty from empty storage', async () => {
  const foreign = memory({ [OLD]: { pods: {}, runtimes: {}, modules: { far: 'https://far.test/x.js' } } })
  expect(await boot(foreign, { load })).toMatchObject({ ok: false, fail: { reason: 'far: https://far.test is another origin, not loaded by this host' } })
  const h = await started(memory())
  expect(newPage(h, 'First')).toMatchObject({ ok: true, value: 'first' })
  expect(await h.pick('first', 'nano.ui/log', 'main')).toMatchObject({ ok: true, value: 'log1' })   // an empty app can still place a pod
})

test('views and the catalog: nano.ui\'s and each module\'s; a pod\'s override from host.views', async () => {
  const h = await started(stored()), views = viewsOf(h), c = catalog(h.registry, views)
  expect(c.find(e => e.implementation === 'nano.ui/log')).toEqual({ implementation: 'nano.ui/log', provider: 'nano.ui', title: 'log', tag: 'nano-log' })
  expect(c.find(e => e.implementation === 'acme/shout')).toMatchObject({ provider: 'acme', tag: 'acme-shout' })
  expect(viewFor('log1', { ...h.app.deployment(), views: h.document().host?.views ?? {} }, views)).toBe('my-log')
})

test('a pick: a lazy pod in the chosen runtime, its slot on the page, nothing started; the workspace\'s layout kept', async () => {
  const s = stored(), h = await started(s)
  expect(await h.pick('workspace', 'nano.ui/log', 'side')).toMatchObject({ ok: true, value: 'log2' })
  expect(h.app.deployment().runtimes['side']!.pods).toEqual(['log2'])
  expect(h.app.runtime('side').status('log2')).toMatchObject({ ok: true, value: 'not started' })
  expect(read(s).outline.pages.workspace.slots.log2).toEqual({ kind: 'pod', pod: 'nano.ui/log@side/log2' })
  expect(read(s).outline.pages.workspace.layout).toEqual(wsLayout)
})

test('remove slot: the slot goes, the pod stays deployed, layout and meta kept; an unknown slot is refused', async () => {
  const s = stored(), h = await started(s)
  expect(edit(h, o => removeSlot(o, 'workspace', 'log1'))).toMatchObject({ ok: true })
  expect(read(s).outline.pages.workspace).toEqual({ slots: {}, layout: wsLayout, title: 'Workspace', meta: { workspace: { order: 0, icon: 'home' } } })
  expect(h.app.deployment().pods['log1']).toBeDefined()
  expect(edit(h, o => removeSlot(o, 'workspace', 'log1'))).toMatchObject({ ok: false })
})

test('a new page: an id from its title, `title` only; columns go in layout.react beside the workspace\'s keys, on any page', async () => {
  const s = stored(), h = await started(s)
  expect(newPage(h, 'My Page!')).toMatchObject({ ok: true, value: 'my-page' })
  expect(newPage(h, 'My Page')).toMatchObject({ ok: true, value: 'my-page-2' })
  expect(read(s).outline.pages['my-page']).toEqual({ slots: {}, title: 'My Page!' })
  expect(titleOf('my-page', h.outline.document().doc.pages['my-page'])).toBe('My Page!')
  expect(titleOf('nope', undefined)).toBe('nope')
  expect(setColumns(h, 'workspace', 3)).toMatchObject({ ok: true })
  expect(read(s).outline.pages.workspace.layout).toEqual({ ...wsLayout, react: { columns: 3 } })
  expect(read(s).outline.pages.workspace.meta).toEqual({ workspace: { order: 0, icon: 'home' } })
  expect(columnsOf(h.outline.document().doc.pages['workspace'])).toBe(3)
  expect(setColumns(h, 'my-page', 4)).toMatchObject({ ok: true })
  expect(read(s).outline.pages['my-page'].layout).toEqual({ react: { columns: 4 } })
  expect(setColumns(h, 'nope', 4)).toMatchObject({ ok: false })
})

test('tabs per level: the roots, then each page on the path to the shown page, its children; a child added under the shown page, a root with no parent', async () => {
  const h = await started(memory())
  newPage(h, 'Top'); newPage(h, 'Sub', 'top'); newPage(h, 'Deep', 'sub'); newPage(h, 'Other')
  const doc = () => h.outline.document().doc
  expect(doc().roots).toEqual(['top', 'other'])
  expect(doc().pages['top']!.children).toEqual(['sub'])
  expect(levels(doc(), 'deep')).toEqual([{ ids: ['top', 'other'], at: 'top' }, { ids: ['sub'], at: 'sub' }, { ids: ['deep'], at: 'deep' }])
  expect(levels(doc(), 'top')).toEqual([{ ids: ['top', 'other'], at: 'top' }, { ids: ['sub'], at: undefined }])
  expect(levels(doc(), 'other')).toEqual([{ ids: ['top', 'other'], at: 'other' }])
  expect(levels({ roots: [], pages: {} }, '')).toEqual([])
  expect(newPage(h, 'X', 'nope')).toMatchObject({ ok: false })
})
