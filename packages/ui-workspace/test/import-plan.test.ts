// The Import dialog's choices, as pure edits of the fetched nano.json: its runtimes renamed, its pods' isolation by Trust.
import { expect, test } from 'bun:test'
import type { AppDeployment } from '@pritzlaff/nano-core'
import { Outline } from '@pritzlaff/nano-outline'
import { ownProvider, renameRuntimes, selectPods, suggestedName, trusted, validRuntimeId } from '../src/import-plan.ts'

const file = (): AppDeployment => ({
  pods: {
    a: { implementation: 'acme.template/timer', eager: false },
    b: { implementation: 'other.x/y', eager: false, isolation: 'sandbox' },
    c: { implementation: 'other.x/y', eager: false, isolation: 'isolated-sandbox' },
  },
  runtimes: { main: { pods: ['a'], subscriptions: [] }, side: { pods: ['b', 'c'], subscriptions: [{ kind: 'call', from: 'b', to: 'c' }] } },
  modules: { 'acme.template': './index.js', 'other.x': './x.js' },
  layout: { desk: { root: 1 } },
})
const written = (v: unknown) => JSON.parse(JSON.stringify(v))
const pagesOf = (w: unknown): Outline => { const r = Outline.parse(w); if (!r.ok) throw new Error(r.fail.reason); return r.value }

test('renameRuntimes renames the runtime keys; the rest, the layout too, is untouched', () => {
  const d = file(), out = renameRuntimes(d, { main: 'acme.template.main', side: 'side' })
  expect(Object.keys(out.runtimes)).toEqual(['acme.template.main', 'side'])
  expect(out.runtimes['acme.template.main']).toEqual(d.runtimes.main!)
  expect(out.runtimes.side).toEqual(d.runtimes.side!)
  expect(out.layout).toEqual({ desk: { root: 1 } })
  expect(out.pods).toEqual(d.pods)
  expect(d).toEqual(file())   // pure
})

test('renameRuntimes with no names changes nothing', () => {
  expect(renameRuntimes(file(), {})).toEqual(file())
})

test("renameRuntimes renames the runtime of imported pages' pod coordinates and selectors; view slots are kept, and the pages stay valid", () => {
  const pages = pagesOf({ pages: { p: { slots: { x: { kind: 'view', view: 'nano-explorer' }, a: { kind: 'pod', pod: 'acme.template/timer@main/a' }, b: { kind: 'pod', pod: 'other.x/y@side/b' },
    s: { kind: 'select', select: { runtime: 'main', tags: ['t'] } }, t: { kind: 'select', select: { tags: ['t'] } } }, meta: { title: 'P' } } } })
  const out = renameRuntimes(pages, { main: 'acme.template.main' })
  expect(written(out)).toEqual({ roots: ['p'], pages: { p: { slots: { x: { kind: 'view', view: 'nano-explorer' }, a: { kind: 'pod', pod: 'acme.template/timer@acme.template.main/a' }, b: { kind: 'pod', pod: 'other.x/y@side/b' },
    s: { kind: 'select', select: { runtime: 'acme.template.main', tags: ['t'] } }, t: { kind: 'select', select: { tags: ['t'] } } }, meta: { title: 'P' } } } })
  expect(Outline.parse(written(out)).ok).toBe(true)
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
  layout: { desk: {} },
})

test('selectPods keeping every pod changes nothing and warns of nothing', () => {
  expect(selectPods(app(), new Set(Object.keys(app().pods)))).toEqual({ deployment: app(), warnings: [] })
})

test('selectPods keeps the ticked pods; drops runtimes left empty, modules no kept pod uses, their tags and views', () => {
  const { deployment: d } = selectPods(app(), new Set(['todos', 'timer', 'store']))
  expect(Object.keys(d.pods)).toEqual(['todos', 'timer', 'store'])
  expect(Object.keys(d.runtimes)).toEqual(['front', 'main'])
  expect(d.modules).toEqual({ 'example.todo': './t.js', 'acme.template': './a.js' })
  expect(d.tags).toEqual({ todos: ['x'], store: ['y'] })
  const { deployment: e } = selectPods(app(), new Set(['todos', 'todoStore', 'timer']))
  expect(e.runtimes['main']).toEqual({ pods: ['timer'], subscriptions: [] })
  expect(e.layout).toEqual({ desk: {} })
  expect(e.tags).toEqual({ todos: ['x'] })
  expect(e.views).toEqual({ 'example.todo/kv': 'todo-list' })
})

test("selectPods drops an unticked pod's slots from the imported pages too; view and selector slots are kept", () => {
  const pages = pagesOf({ pages: { p: { slots: { todos: { kind: 'pod', pod: 'example.todo/kv@front/todos' }, x: { kind: 'view', view: 'nano-explorer' }, store: { kind: 'pod', pod: 'acme.template/store@main/store' }, s: { kind: 'select', select: { runtime: 'main' } } } } } })
  expect(written(selectPods(pages, new Set(['todos', 'timer'])))).toEqual({ roots: ['p'], pages: { p: { slots: { todos: { kind: 'pod', pod: 'example.todo/kv@front/todos' }, x: { kind: 'view', view: 'nano-explorer' }, s: { kind: 'select', select: { runtime: 'main' } } } } } })
})

test('selectPods keeps a subscription only with both ends; one end kept is a warning, as text', () => {
  const { deployment: d, warnings } = selectPods(app(), new Set(['todos', 'timer']))
  expect(d.runtimes['main']!.subscriptions).toEqual([])
  expect(warnings).toEqual([
    { pod: 'todos', text: 'todos calls todoStore, which is not selected: todos will fail when it runs' },
    { pod: 'timer', text: 'pipe timer.tick → store.set is left out (store not selected)' },
  ])
  expect(selectPods(app(), new Set(['todoStore', 'store'])).warnings).toEqual([
    { pod: 'todoStore', text: 'call todos → todoStore is left out (todos not selected)' },
    { pod: 'store', text: 'pipe timer.tick → store.set is left out (timer not selected)' },
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

test('a home-origin pod stays home-origin under either Trust (it runs as its own origin), and its frames entry follows selection', () => {
  const d = file(); d.pods['b'] = { ...d.pods['b']!, isolation: 'home-origin' }; d.frames = { 'other.x': 'https://other.x/frame.html' }
  expect(trusted(d, 'sandboxed').pods['b']!.isolation).toBe('home-origin')
  expect(trusted(d, 'trusted').pods['b']!.isolation).toBe('home-origin')
  expect(selectPods(d, new Set(['b'])).deployment.frames).toEqual({ 'other.x': 'https://other.x/frame.html' })
  expect(selectPods(d, new Set(['a'])).deployment.frames).toEqual({})
})
