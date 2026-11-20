// The docks on their pages with the real host: a dock keeps its page (its engine state under the page's `workspace`,
// its panels the page's slots), opening a page gets or creates its pods, and a pick deploys a lazy pod first.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: new URL('../../../', import.meta.url).href })
import { afterEach, expect, mock, test } from 'bun:test'
import type { Page } from '@pritzlaff/nano-ui'
import type { PanelState } from '../src/lib/layout-templates.ts'

let choice: PanelState | null = null, runtime: string | undefined   // the picker, stubbed
mock.module('../src/components/picker.ts', () => ({ pick: async () => choice && { state: choice, runtime } }))
mock.module('../src/components/picker-grid.ts', () => ({ pickerGrid: (host: HTMLElement) => new Promise(r => { host.addEventListener('click', () => choice && r({ state: choice, runtime })) }) }))   // inline: a click picks `choice`
const { defineViews } = await import('@pritzlaff/nano-ui')
const { start } = await import('../src/host.ts')
await import('../src/components/workspace-dock.ts')
const { addPod, implementationTemplates } = await import('../src/dock/panels.ts')
const { createBus, provideBus } = await import('../src/lib/bus.ts')
const { pageStore } = await import('../src/lib/pages.ts')
const { bootWorkspacePages } = await import('../src/components/workspace-pages.ts')
defineViews()

type H = Extract<Awaited<ReturnType<typeof start>>, { ok: true }>['value']
type Dock = HTMLElement & { host?: H; setTemplate(id: string): boolean; template: string }
const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise(r => setTimeout(r, 5)); expect(ok()).toBe(true) }
afterEach(() => { document.body.innerHTML = ''; choice = null; runtime = undefined })

const host = async () => { const r = await start(); if (!r.ok) throw new Error(r.fail.reason); return r.value }
/** Places `pods` (lazy, of `impl`) in runtime `at`, made with `policy` if new: a stored document as a fresh host loads it. */
const place = async (h: H, at: string, pods: string[], impl = 'nano.ui/input', policy?: unknown) => {
  const d = h.data(), rt = d.runtimes[at] ?? { pods: [], subscriptions: [], ...(policy !== undefined && { policy }) }
  const r = await h.apply({ ...d, pods: { ...d.pods, ...Object.fromEntries(pods.map(p => [p, { implementation: impl, eager: false }])) }, runtimes: { ...d.runtimes, [at]: { ...rt, pods: [...rt.pods, ...pods] } } } as never)
  if (!r.ok) throw new Error(r.fail.reason)
}
const slot = (pod: string, runtime = 'main') => ({ id: pod, runtime, pod })
const running = (h: H, pod: string) => { const s = h.app.runtime('main').status(pod); return s.ok && s.value === 'running' }

/** The workspace's pages over `h`: Main's dock and one per other page, in hidden routes until `go` shows one (as app-shell does). */
function mount(h: H, pages: Page[], open = '') {
  const store = pageStore(pages, (r, p) => !!h.data().runtimes[r]?.pods.includes(p)), bus = createBus(), app = document.createElement('div')
  provideBus(app, bus)
  app.innerHTML = `<span slot="title"></span><div class="nav-row" data-workspaces><a href="#/workspace"></a></div>
    <app-route path="/workspace" hidden><workspace-dock id="workspace" storage-key="main" open="${open}"><template data-widget="notes" data-title="Notes"><div>notes</div></template></workspace-dock></app-route>
    <app-route path="*" hidden></app-route>`
  const main = app.querySelector<Dock>('workspace-dock')!
  main.host = h
  main.prepend(...implementationTemplates(h, document))
  document.body.append(app)
  bootWorkspacePages(document, store)
  const go = (id: string) => {
    for (const r of document.querySelectorAll<HTMLElement>('app-route')) r.hidden = r.getAttribute('path') !== `/${id}`
    bus.publish('route:changed', { path: `/${id}` }, 'test')
  }
  const dock = (id: string) => document.querySelector<Dock>(`app-route[path="/${id}"] workspace-dock`)!
  const panels = (id: string) => [...dock(id)?.querySelectorAll<HTMLElement>('.dock-panel') ?? []]   // none while a dock is built again
  return { store, go, dock, panels, input: implementationTemplates(h, document).find(t => t.dataset['implementation'] === 'nano.ui/input')!.dataset['widget']! }
}
const starts = (h: H) => { const to: string[] = []; h.app.listen(e => { if (e.type === 'sent' && e.kind === 'start') to.push(e.to) }); return to }
/** Each getOrCreate's `started`, in order. */
const opened = (h: H) => {
  const seen: boolean[] = [], runtime = h.app.runtime.bind(h.app)
  h.app.runtime = ((id: string) => { const v = runtime(id); return { ...v, getOrCreate: async (p: string) => { const r = await v.getOrCreate(p); if (r.ok) seen.push(r.value.started); return r } } }) as never
  return seen
}

test('a reload (a fresh host from the stored document) opens the same pods: no new names, started once, then reused on a second page (Review Focus 2)', async () => {
  const h = await host()
  await place(h, 'main', ['input1'])
  const names = Object.keys(h.data().pods).sort(), started = starts(h), seen = opened(h)
  const { go, panels } = mount(h, [{ id: 'workspace', title: 'Main', slots: [slot('input1')] }, { id: 'two', title: 'Two', slots: [slot('input1')] }])
  await new Promise(r => setTimeout(r, 20))
  expect(h.app.runtime('main').status('input1')).toEqual({ ok: true, value: 'not started' })   // not at boot
  go('workspace')
  await until(() => panels('workspace')[0]?.childElementCount === 1)
  await until(() => started.length === 1)
  expect(started).toEqual(['input1'])
  go('two')
  await until(() => panels('two')[0]?.childElementCount === 1)
  go('workspace'); go('two')
  await new Promise(r => setTimeout(r, 20))
  expect(started).toEqual(['input1'])   // the second page reused it; showing a page again opens nothing
  expect(seen).toEqual([true, false])
  expect(Object.keys(h.data().pods).sort()).toEqual(names)
})

test('a pick deploys a lazy pod in the runtime, adds its slot, and opening it starts it', async () => {
  const h = await host(), started = starts(h)
  const { go, store, input, panels } = mount(h, [])
  go('workspace')
  choice = { widget: input }
  document.querySelector<HTMLElement>('.dock-empty')!.click()
  await until(() => store.get('workspace')!.slots.length === 1)
  expect(h.data().pods['input1']).toEqual({ implementation: 'nano.ui/input', eager: false })
  expect(store.get('workspace')!.slots).toEqual([slot('input1')])
  await until(() => started.length === 1 && panels('workspace')[0]!.childElementCount === 1)
  expect(h.app.runtime('main').status('input1')).toEqual({ ok: true, value: 'running' })
})

test('a pick into a chosen runtime places the pod there', async () => {
  const h = await host()
  await place(h, 'edge', ['other'])
  const { go, store, input } = mount(h, [])
  go('workspace')
  choice = { widget: input }; runtime = 'edge'
  document.querySelector<HTMLElement>('.dock-empty')!.click()
  await until(() => store.get('workspace')!.slots.length === 1)
  expect(h.data().runtimes['edge']!.pods).toContain('input1')
  expect(h.data().runtimes['main']!.pods).not.toContain('input1')
  expect(store.get('workspace')!.slots).toEqual([slot('input1', 'edge')])
})

test('addPod in a rules runtime adds the rule letting the host reach the pod, so it can be started', async () => {
  const h = await host()
  await place(h, 'locked', ['other'], 'nano.ui/input', { kind: 'rules', rules: [{ deny: '*' }] })
  const name = await addPod(h, 'nano.ui/input', 'locked')
  expect(name).toBe('input1')
  expect(h.data().runtimes['locked']!.policy).toEqual({ kind: 'rules', rules: [{ allow: ['call', 'subscribe', 'start'], from: 'host', outside: true, toPod: 'input1' }, { deny: '*' }] })
  expect((await h.app.runtime('locked').getOrCreate('input1')).ok).toBe(true)
})

test('concurrent adds of one implementation take distinct names', async () => {
  const h = await host()
  const names = await Promise.all([addPod(h, 'nano.ui/input', 'main'), addPod(h, 'nano.ui/input', 'main')])
  expect(new Set(names).size).toBe(2)
  expect(names.every(n => n && n in h.data().pods)).toBe(true)
})

test('a slot whose pod fails shows the reason in its panel; the others open (Review Focus 5)', async () => {
  const h = await host()
  await place(h, 'locked', ['x'], 'nano.ui/input', { kind: 'rules', rules: [] })
  await place(h, 'main', ['input1'])
  const { go, panels } = mount(h, [{ id: 'workspace', title: 'Main', slots: [slot('x', 'locked'), slot('input1')] }])
  go('workspace')
  await until(() => panels('workspace').length === 2 && panels('workspace').some(p => p.textContent!.includes('no rule allows it')))
  await until(() => running(h, 'input1'))
})

test('a page changed through the store (a slot added) shows it in the dock; one removed goes', async () => {
  const h = await host()
  await place(h, 'main', ['input1', 'input2'])
  const { go, store, panels } = mount(h, [{ id: 'workspace', title: 'Main', slots: [slot('input1')] }])
  go('workspace')
  await until(() => panels('workspace').length === 1)
  store.set({ ...store.get('workspace')!, slots: [slot('input1'), slot('input2'), { id: 'notes', view: 'notes' }] })
  await until(() => panels('workspace').length === 3)
  await until(() => running(h, 'input2'))
  store.set({ ...store.get('workspace')!, slots: [slot('input2')] })
  await until(() => panels('workspace').length === 1)
  expect(store.get('workspace')!.slots).toEqual([slot('input2')])
})

test('closing a panel removes its slot, not its pod', async () => {
  const h = await host()
  await place(h, 'main', ['input1', 'input2'])
  const { go, store, dock } = mount(h, [{ id: 'workspace', title: 'Main', slots: [slot('input1'), slot('input2')] }])
  go('workspace')
  await until(() => dock('workspace').querySelectorAll('.dock-panel').length === 2)
  dock('workspace').setTemplate('two-cols')
  dock('workspace').querySelector<HTMLElement>('.tpl-remove')!.click()
  expect(store.get('workspace')!.slots.length).toBe(1)
  expect(Object.keys(h.data().pods)).toContain('input1')
  expect(Object.keys(h.data().pods)).toContain('input2')
})

test('the dock\'s state is its page\'s: its layout and template are in the page\'s `workspace`, nothing in localStorage', async () => {
  const h = await host()
  await place(h, 'main', ['input1'])
  const { go, store, dock } = mount(h, [{ id: 'workspace', title: 'Main', slots: [slot('input1')] }])
  go('workspace')
  await until(() => dock('workspace').querySelectorAll('.dock-panel').length === 1)
  ;(dock('workspace') as Dock & { save(): void }).save()
  expect(JSON.stringify(store.get('workspace')!['workspace'])).toContain('"input1"')
  dock('workspace').setTemplate('one')
  expect((store.get('workspace')!['workspace'] as { template?: { template: string } }).template?.template).toBe('one')
  expect(localStorage.length).toBe(0)
})

/** A reload: the page shown again from the pages as the store now has them, on the same host. */
const reload = (h: H, store: { list(): Page[] }, open = '') => { const pages = store.list(); document.body.innerHTML = ''; return mount(h, pages, open) }
const swapped = (d: Dock) => { const sel = d.querySelector<HTMLSelectElement>('.tpl-pos select')!; sel.value = sel.options[1]!.value; sel.dispatchEvent(new Event('change')) }
const order = (d: Dock & { arrangement?(): { template?: { order: unknown[] } } }) => (d as unknown as { arrangement(): { template?: { order: ({ name?: string } | null)[] } } }).arrangement().template?.order.map(p => p?.name)

test('every change is kept (ADR-0036): a move unsaved is there after a reload; Restore returns to what Save kept', async () => {
  const h = await host()
  await place(h, 'main', ['input1', 'input2'])
  const first = mount(h, [{ id: 'workspace', title: 'Main', slots: [slot('input1'), slot('input2')] }])
  first.go('workspace')
  await until(() => first.panels('workspace').length === 2)
  first.dock('workspace').setTemplate('two-cols')
  ;(first.dock('workspace') as Dock & { save(): void }).save()
  swapped(first.dock('workspace'))
  expect(order(first.dock('workspace'))).toEqual(['input2', 'input1'])
  const again = reload(h, first.store)
  again.go('workspace')
  await until(() => again.panels('workspace').length === 2)
  expect(again.dock('workspace').template).toBe('two-cols')
  expect(order(again.dock('workspace'))).toEqual(['input2', 'input1'])
  ;(again.dock('workspace') as Dock & { restore(): void }).restore()
  expect(order(again.dock('workspace'))).toEqual(['input1', 'input2'])
})

test('Main\'s starting panel closed without saving stays closed after a reload', async () => {
  const h = await host()
  const first = mount(h, [], 'notes')
  first.go('workspace')
  await until(() => first.panels('workspace').length === 1)
  expect(first.store.get('workspace')!.slots).toEqual([{ id: 'notes', view: 'notes' }])
  first.dock('workspace').querySelector<HTMLElement>('.lm_close_tab')!.click()
  await until(() => first.store.get('workspace')!.slots.length === 0)
  const again = reload(h, first.store, 'notes')
  again.go('workspace')
  await new Promise(r => setTimeout(r, 20))
  expect(again.panels('workspace').length).toBe(0)
})

test('a slot added to a visited page that is hidden opens its pod only when the page shows again', async () => {
  const h = await host()
  await place(h, 'main', ['input1', 'input2'])
  const { go, store, panels } = mount(h, [{ id: 'workspace', title: 'Main', slots: [] }, { id: 'two', title: 'Two', slots: [slot('input1')] }])
  go('two')
  await until(() => running(h, 'input1'))
  go('workspace')
  store.set({ ...store.get('two')!, slots: [slot('input1'), slot('input2')] })   // as a pod's setPage would
  await new Promise(r => setTimeout(r, 30))
  expect(h.app.runtime('main').status('input2')).toEqual({ ok: true, value: 'not started' })
  go('two')
  await until(() => running(h, 'input2') && panels('two').length === 2)
})

test('a view slot this dock has no widget for is kept when the dock rewrites the slots', async () => {
  const h = await host()
  const other = { id: 'elsewhere', view: 'other-front-end-view' }
  const { go, store, dock } = mount(h, [{ id: 'workspace', title: 'Main', slots: [other, { id: 'notes', view: 'notes' }] }])
  go('workspace')
  await until(() => dock('workspace').querySelectorAll('.dock-panel').length === 1)
  dock('workspace').setTemplate('two-cols')   // a dock:layout
  expect(store.get('workspace')!.slots).toEqual([{ id: 'notes', view: 'notes' }, other])
})

test('a pod that failed to open is opened on a later apply that lets the host in', async () => {
  const h = await host()
  await place(h, 'locked', ['x'], 'nano.ui/input', { kind: 'rules', rules: [] })
  const { go, panels } = mount(h, [{ id: 'workspace', title: 'Main', slots: [slot('x', 'locked')] }])
  go('workspace')
  await until(() => panels('workspace')[0]?.textContent === 'no rule allows it')
  const d = h.data()
  expect((await h.apply({ ...d, runtimes: { ...d.runtimes, locked: { ...d.runtimes['locked']!, policy: { kind: 'rules', rules: [{ allow: '*' }] } } } })).ok).toBe(true)
  await until(() => h.app.runtime('locked').status('x').ok && panels('workspace')[0]!.querySelector('.dock-fail') === null)
})
