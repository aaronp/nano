// The Import dialog's choices, as pure edits of the fetched nano.json: its runtimes renamed, its pods' isolation by Trust.
import { expect, test } from 'bun:test'
import type { AppDeployment } from '@pritzlaff/nano-core'
import { ownProvider, renameRuntimes, selectPods, suggestedName, trusted, validRuntimeId } from '../src/import-plan.ts'

const file = (): AppDeployment => ({
  pods: {
    a: { implementation: 'acme.template/timer', eager: false },
    b: { implementation: 'other.x/y', eager: false, isolation: 'sandbox' },
    c: { implementation: 'other.x/y', eager: false, isolation: 'isolated-sandbox' },
  },
  runtimes: { main: { pods: ['a'], subscriptions: [] }, side: { pods: ['b', 'c'], subscriptions: [{ kind: 'call', from: 'b', to: 'c' }] } },
  modules: { 'acme.template': './index.js', 'other.x': './x.js' },
  layout: { workspace: { root: 1 }, slots: [{ id: 'a', runtime: 'main', pod: 'a' }, { id: 'b', runtime: 'side', pod: 'b' }] },
})

test('renameRuntimes renames the runtime keys and the layout slots naming them; the rest is untouched', () => {
  const d = file(), out = renameRuntimes(d, { main: 'acme.template.main', side: 'side' })
  expect(Object.keys(out.runtimes)).toEqual(['acme.template.main', 'side'])
  expect(out.runtimes['acme.template.main']).toEqual(d.runtimes.main!)
  expect(out.runtimes.side).toEqual(d.runtimes.side!)
  expect(out.layout).toEqual({ workspace: { root: 1 }, slots: [{ id: 'a', runtime: 'acme.template.main', pod: 'a' }, { id: 'b', runtime: 'side', pod: 'b' }] })
  expect(out.pods).toEqual(d.pods)
  expect(d).toEqual(file())   // pure
})

test('renameRuntimes with no names, or a file without layout, changes nothing', () => {
  expect(renameRuntimes(file(), {})).toEqual(file())
  const { layout: _, ...bare } = file()
  expect(renameRuntimes(bare, { main: 'm' }).layout).toBeUndefined()
})

test('suggestedName is the provider namespace of the runtime’s first pod by modules order, then the runtime', () => {
  expect(suggestedName(file(), 'main')).toBe('acme.template.main')
  expect(suggestedName(file(), 'side')).toBe('other.x.side')
  const d = file(); d.runtimes.side!.pods = ['b', 'a']   // spans two: the first in modules order
  expect(suggestedName(d, 'side')).toBe('acme.template.side')
  expect(suggestedName({ ...file(), runtimes: { e: { pods: [], subscriptions: [] } } }, 'e')).toBe('e')
  expect(suggestedName(file(), 'main', c => c === 'acme.template')).toBe('main')   // a provider the workspace has: not the file's own
  expect(suggestedName({ ...file(), runtimes: { 'a.b': { pods: ['a'], subscriptions: [] } } }, 'a.b')).toBe('a.b')   // already namespaced
})

test('validRuntimeId: no /, whitespace or #, 1 to 64 chars', () => {
  for (const ok of ['acme.template.main', 'a']) expect(validRuntimeId(ok)).toBe(true)
  for (const bad of ['', 'a/b', 'a b', 'a#b', 'x'.repeat(65)]) expect(validRuntimeId(bad)).toBe(false)
})

test('trusted: sandboxed makes every pod isolated-sandbox; trusted makes host, but keeps a file’s sandbox or isolated-sandbox', () => {
  expect(Object.values(trusted(file(), 'sandboxed').pods).map(p => p.isolation)).toEqual(['isolated-sandbox', 'isolated-sandbox', 'isolated-sandbox'])
  expect(Object.values(trusted(file(), 'trusted').pods).map(p => p.isolation ?? 'host')).toEqual(['host', 'sandbox', 'isolated-sandbox'])
})

test('trusted leaves pods of a provider the workspace already has as the file says', () => {
  expect(Object.values(trusted(file(), 'sandboxed', c => c === 'acme.template').pods).map(p => p.isolation ?? 'host')).toEqual(['host', 'isolated-sandbox', 'isolated-sandbox'])
})

const app = (): AppDeployment => ({
  pods: {
    todos: { implementation: 'example.todo/kv', eager: false }, todoStore: { implementation: 'example.kv/memory', eager: false },
    timer: { implementation: 'acme.template/timer', eager: false }, store: { implementation: 'acme.template/store', eager: false },
  },
  runtimes: {
    front: { pods: ['todos'], subscriptions: [] },
    back: { pods: ['todoStore'], subscriptions: [{ kind: 'call', from: 'todos', to: 'todoStore' }], policy: { kind: 'rules', rules: [{ allow: '*', from: 'todos', outside: true }] } },
    main: { pods: ['timer', 'store'], subscriptions: [{ kind: 'pipe', from: 'timer', source: 'acme.template.Timer/tick', to: 'store', target: 'acme.template.Store/set' }] },
  },
  modules: { 'example.todo': './t.js', 'example.kv': './kv.js', 'acme.template': './a.js' },
  tags: { todos: ['x'], store: ['y'] }, views: { 'example.todo/kv': 'todo-list', 'acme.template/store': 'nano-store' },
  layout: { slots: [{ id: 'todos', runtime: 'front', pod: 'todos' }, { id: 'store', runtime: 'main', pod: 'store' }], geometry: {} },
})

test('selectPods keeping every pod changes nothing and warns of nothing', () => {
  expect(selectPods(app(), new Set(Object.keys(app().pods)))).toEqual({ deployment: app(), warnings: [] })
})

test('selectPods keeps the ticked pods; drops runtimes left empty, modules no kept pod uses, their slots, tags and views', () => {
  const { deployment: d } = selectPods(app(), new Set(['todos', 'timer', 'store']))
  expect(Object.keys(d.pods)).toEqual(['todos', 'timer', 'store'])
  expect(Object.keys(d.runtimes)).toEqual(['front', 'main'])
  expect(d.modules).toEqual({ 'example.todo': './t.js', 'acme.template': './a.js' })
  expect(d.tags).toEqual({ todos: ['x'], store: ['y'] })
  const { deployment: e } = selectPods(app(), new Set(['todos', 'todoStore', 'timer']))
  expect(e.runtimes['main']).toEqual({ pods: ['timer'], subscriptions: [] })
  expect((e.layout as { slots: unknown[] }).slots).toEqual([{ id: 'todos', runtime: 'front', pod: 'todos' }])
  expect(e.layout?.['geometry']).toEqual({})
  expect(e.tags).toEqual({ todos: ['x'] })
  expect(e.views).toEqual({ 'example.todo/kv': 'todo-list' })
})

test('selectPods keeps a subscription only with both ends; one end kept is a warning, as text', () => {
  const { deployment: d, warnings } = selectPods(app(), new Set(['todos', 'timer']))
  expect(d.runtimes['main']!.subscriptions).toEqual([])
  expect(warnings).toEqual([
    'todos calls todoStore, which is not selected: todos will fail when it runs',
    'pipe timer.tick → store.set is left out (store not selected)',
  ])
  expect(selectPods(app(), new Set(['todoStore', 'store'])).warnings).toEqual([
    'call todos → todoStore is left out (todos not selected)',
    'pipe timer.tick → store.set is left out (timer not selected)',
  ])
})

test('selectPods leaves policy rules naming unticked pods as they are; a runtime left empty takes its policy with it', () => {
  const rules = app().runtimes['back']!.policy
  expect(selectPods(app(), new Set(['todoStore'])).deployment.runtimes['back']!.policy).toEqual(rules)
  expect(selectPods(app(), new Set(['todos'])).deployment.runtimes['back']).toBeUndefined()
})

test("only a provider the workspace loaded from its own origin counts as its own: a foreign one imported before still gets Trust", () => {
  expect(ownProvider(true, '/bundle/nano-ui.js')).toBe(true)
  expect(ownProvider(true, 'https://other.test/index.js')).toBe(false)
  expect(ownProvider(false, '/bundle/nano-ui.js')).toBe(false)
})

test('a pod the import sandboxes is eager: its frame (and view) opens at once, since nothing in the page can call it first', () => {
  const sandboxed = trusted(file(), 'sandboxed'), kept = trusted(file(), 'sandboxed', c => c === 'acme.template')
  expect(Object.values(sandboxed.pods).map(p => p.eager)).toEqual([true, true, true])
  expect(Object.values(trusted(file(), 'trusted').pods).map(p => [p.isolation ?? 'host', p.eager])).toEqual([['host', false], ['sandbox', true], ['isolated-sandbox', true]])
  expect(Object.values(kept.pods)[0]!.eager).toBe(false)   // a pod Trust leaves alone keeps its own
})
