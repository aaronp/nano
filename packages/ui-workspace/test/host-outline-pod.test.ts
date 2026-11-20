// HostOutline in the workspace: the pod `outline` over the Outline. `document` is unasked; `apply` with a stale base
// is refused before anyone is asked, with the current base it is asked (naming the pages and slots), then applied.
import { expect, jest, test } from 'bun:test'
import { flat } from './flat.ts'
import { Application, AppDeployment, Coord, Pod, Registry, type NanoResult } from '@pritzlaff/nano-core'
import { HostOutline, Outline } from '@pritzlaff/nano-outline'
import './host-deploy-setup.ts'

const { hostOutline, outlinePod } = await import('../src/host-outline-pod.ts')
const { hostProvider } = await import('../src/host-deploy.ts')
const { hostUi } = await import('../src/host-ui.ts')

type Written = { roots?: string[]; pages: Record<string, { slots: Record<string, unknown>; children?: string[]; meta?: unknown }> }
type PodApi = { document(n: null): Promise<NanoResult<{ doc: Written; version: number }>>; apply(a: { next: Written; base: number }): Promise<NanoResult<unknown>> }
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const ns = Coord.namespace('workspace.host')

async function podApp(answer: () => Promise<boolean>) {
  const asked: string[] = [], registry = Registry.create()
  let outline: ReturnType<typeof Outline.create> | undefined
  registry.add(ns.provider([hostOutline(() => outline, t => { asked.push(t); return answer() })]))
  const d: AppDeployment = { pods: { outline: outlinePod }, runtimes: { main: { pods: ['outline'], subscriptions: [] } } }
  const app = must(await Application.create(must(AppDeployment.assemble(d, registry))))
  outline = Outline.create(app, registry, flat({ workspace: { slots: { x: { kind: 'view', view: 'nano-explorer' } } } }))
  return { asked, app, outline, pod: app.call('main', 'outline') as unknown as PodApi }
}

test('document is the pages, written, at their version, unasked', async () => {
  const { asked, app, pod } = await podApp(async () => true)
  expect(must(await pod.document(null))).toEqual({ doc: { roots: ['workspace'], pages: { workspace: { slots: { x: { kind: 'view', view: 'nano-explorer' } } } } }, version: 0 })
  expect(asked).toEqual([])
  await app.close()
})

test('apply with a stale base is refused, unasked; with the current base it is asked, a no changes nothing, a yes applies', async () => {
  let yes = false
  const { asked, app, outline, pod } = await podApp(async () => yes)
  const at = must(await pod.document(null)), next: Written = { pages: { ...at.doc.pages, notes: { slots: { n: { kind: 'view', view: 'notes' } } } } }
  outline.apply(flat({ ...outline.document().doc.pages, other: { slots: {} } }))   // the workspace's own edit, since
  expect(await pod.apply({ next, base: at.version })).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'the pages changed since' } })
  expect(asked).toEqual([])
  const now = must(await pod.document(null)), again: Written = { pages: { ...now.doc.pages, notes: { slots: { n: { kind: 'view', view: 'notes' } } }, workspace: { slots: {} } } }
  expect(await pod.apply({ next: again, base: now.version })).toMatchObject({ ok: false, fail: { type: 'denied' } })
  expect(asked).toEqual(['Add page notes; page workspace: remove slot x'])
  expect(Object.keys(outline.document().doc.pages)).toEqual(['workspace', 'other'])
  yes = true
  expect(await pod.apply({ next: again, base: now.version })).toMatchObject({ ok: true })
  expect(Object.keys(outline.document().doc.pages)).toEqual(['workspace', 'other', 'notes'])
  expect(await pod.apply({ next: { pages: { 'bad id': { slots: {} } } }, base: outline.document().version })).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  await app.close()
})

test('removing Main or adding a page on one of the workspace\'s own routes is refused, unasked', async () => {
  const { asked, app, outline, pod } = await podApp(async () => true)
  expect(await pod.apply({ next: { pages: { other: { slots: {} } } }, base: 0 })).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'Main (the page workspace) is not removed' } })
  for (const id of ['ring', 'settings', 'inbox'])
    expect(await pod.apply({ next: { pages: { workspace: { slots: {} }, [id]: { slots: {} } } }, base: 0 })).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: `${id} is the workspace's own route, not a page` } })
  expect(asked).toEqual([])
  expect(Object.keys(outline.document().doc.pages)).toEqual(['workspace'])
  await app.close()
})

test('the pages changing while the approval waits: the yes is refused, as stale', async () => {
  let outline: ReturnType<typeof Outline.create> | undefined
  const { app, outline: p, pod } = await podApp(async () => { outline!.apply(flat({ ...outline!.document().doc.pages, mine: { slots: {} } })); return true })
  outline = p
  expect(await pod.apply({ next: { pages: { workspace: { slots: {} }, theirs: { slots: {} } } }, base: 0 })).toMatchObject({ ok: false, fail: { type: 'invalid-input', reason: 'the pages changed since' } })
  expect(Object.keys(p.document().doc.pages)).toEqual(['workspace', 'mine'])
  await app.close()
})

test('through hostProvider, the ask is the ui pod\'s dialog, and no answer within 20 s is a no', async () => {
  const registry = Registry.create()
  let app: Application | undefined, outline: ReturnType<typeof Outline.create> | undefined
  registry.add(hostProvider(() => app!, () => outline))
  const d: AppDeployment = { pods: { ui: Pod.eager(hostUi), outline: outlinePod }, runtimes: { main: { pods: ['ui', 'outline'], subscriptions: [] } } }
  app = must(await Application.create(must(AppDeployment.assemble(d, registry))))
  outline = Outline.create(app, registry)
  jest.useFakeTimers()
  try {
    const r = (app.call('main', 'outline') as unknown as PodApi).apply({ next: { pages: { workspace: { slots: {} }, trading: { slots: {} } } }, base: 0 })
    for (let i = 0; i < 50 && !document.querySelector('dialog'); i++) { await Promise.resolve(); jest.advanceTimersByTime(1) }
    expect(document.querySelector('dialog')?.textContent).toContain('Add page trading')
    jest.advanceTimersByTime(20_000)
    expect(await r).toMatchObject({ ok: false, fail: { type: 'denied' } })
  } finally { jest.useRealTimers() }
  expect(outline.document().doc.pages).toEqual({})   // created empty; nothing applied
  document.querySelector('dialog')?.remove()
  await app.close()
})

test('without an Outline (a replayed app\'s provider), both are not-found', async () => {
  const registry = Registry.create()
  registry.add(ns.provider([hostOutline(() => undefined, async () => true)]))
  const app = must(await Application.create(must(AppDeployment.assemble({ pods: { outline: outlinePod }, runtimes: { main: { pods: ['outline'], subscriptions: [] } } }, registry))))
  const pod = app.call('main', 'outline') as unknown as PodApi
  expect(await pod.document(null)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  await app.close()
})

test('the pod publishes the Outline\'s changes as its `changed` event, once built', async () => {
  const { app, outline, pod } = await podApp(async () => true)
  const heard: unknown[] = []
  app.runtime('main').subscribe(HostOutline.ops.changed, e => { heard.push(e) })
  must(await pod.document(null))   // built
  must(outline.apply({ roots: ['workspace', 'a'], pages: { ...outline.document().doc.pages, a: { slots: {} } } }))
  const at = must(await pod.document(null))
  expect(await pod.apply({ next: { roots: ['workspace'], pages: { ...at.doc.pages, workspace: { ...at.doc.pages['workspace']!, children: ['a'] } } }, base: at.version })).toMatchObject({ ok: true })
  await new Promise(r => setTimeout(r, 0))
  expect(heard).toEqual([{ output: { added: ['a'], removed: [], changed: [], moved: [] } }, { output: { added: [], removed: [], changed: [], moved: ['a'] } }])
  await app.close()
})

test('the approval summary names the pages moved', async () => {
  const { asked, app, outline, pod } = await podApp(async () => false)
  must(outline.apply({ roots: ['workspace', 'a', 'b'], pages: { ...outline.document().doc.pages, a: { slots: {} }, b: { slots: {} } } }))
  const at = must(await pod.document(null))
  await pod.apply({ next: { roots: ['workspace', 'b', 'a'], pages: at.doc.pages }, base: at.version })
  expect(asked).toEqual(['Move page b; Move page a'])
  await app.close()
})

test('the approval\'s moved pages are the Outline\'s reported `moved`: a reorder among children, a reparent, a roots-only change', async () => {
  const { asked, app, outline, pod } = await podApp(async () => true)
  const moved: string[][] = []
  outline.listen(c => { moved.push(c.moved) })
  const p = (...children: string[]) => ({ slots: {}, ...(children.length && { children }) })
  must(outline.apply({ roots: ['workspace', 'a', 'b'], pages: { workspace: p(), a: p('x', 'y'), x: p(), y: p(), b: p() } }))
  moved.length = 0
  for (const next of [
    { roots: ['workspace', 'a', 'b'], pages: { workspace: p(), a: p('y', 'x'), x: p(), y: p(), b: p() } },
    { roots: ['workspace', 'a'], pages: { workspace: p(), a: p('y', 'b', 'x'), x: p(), y: p(), b: p() } },
    { roots: ['workspace', 'b', 'a'], pages: { workspace: p(), a: p('y', 'x'), x: p(), y: p(), b: p() } },
  ]) must(await pod.apply({ next, base: outline.document().version }))
  expect(moved.every(m => m.length > 0)).toBe(true)
  expect(asked.map(t => t.split('; ').filter(s => s.startsWith('Move page ')).map(s => s.slice('Move page '.length)))).toEqual(moved)
  await app.close()
})
