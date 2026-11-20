// The docks on their pages with the real host: a dock keeps its page (its engine state in the page's `layout`, its
// restore point in its `meta`, its panels the page's slots), showing a page opens its pods (`platform.open`, once), and
// a pick deploys a lazy pod first, then applies its slot.
import { expect, test } from 'bun:test'
import { addPod, host, mount, opened, page, pick, place, pod, running, starts, tick, until, type Dock, type H } from './dock-pods-setup.ts'

test('two pages share a pod: started once, by showing the first page; the second reuses it; showing a page again opens nothing; no new names', async () => {
  const h = await host()
  await place(h, 'main', ['input1'])
  const names = Object.keys(h.data().pods).sort(), started = starts(h), seen = opened(h)
  const { go, panels } = mount(h, { workspace: page('Main', { a: pod('input1') }, 0), two: page('Two', { b: pod('input1') }) })
  await tick()
  expect(h.app.runtime('main').status('input1')).toEqual({ ok: true, value: 'not started' })   // not at boot
  go('workspace')
  await until(() => panels('workspace')[0]?.childElementCount === 1)
  await until(() => started.length === 1)
  expect(started).toEqual(['input1'])
  go('two')
  await until(() => panels('two')[0]?.childElementCount === 1)
  go('workspace'); go('two')
  await tick()
  expect(started).toEqual(['input1'])
  expect(seen).toEqual([true, false])
  expect(Object.keys(h.data().pods).sort()).toEqual(names)
})

test('a pick deploys a lazy pod in the runtime, then applies its `pod` slot, and opening it starts it', async () => {
  const h = await host(), started = starts(h)
  const { go, written, input, panels } = mount(h, {})
  go('workspace')
  pick.choice = { widget: input }
  document.querySelector<HTMLElement>('.dock-empty')!.click()
  await until(() => Object.keys(written('workspace').slots).length === 1)
  expect(h.data().pods['input1']).toEqual({ implementation: 'nano.ui/input', eager: false })
  expect(written('workspace').slots).toEqual({ input1: { kind: 'pod', pod: 'nano.ui/input@main/input1' } })
  await until(() => started.length === 1 && panels('workspace')[0]!.childElementCount === 1)
  expect(running(h, 'input1')).toBe(true)
})

test('a pick into a chosen runtime places the pod there', async () => {
  const h = await host()
  await place(h, 'edge', ['other'])
  const { go, written, input } = mount(h, {})
  go('workspace')
  pick.choice = { widget: input }; pick.runtime = 'edge'
  document.querySelector<HTMLElement>('.dock-empty')!.click()
  await until(() => Object.keys(written('workspace').slots).length === 1)
  expect(h.data().runtimes['edge']!.pods).toContain('input1')
  expect(h.data().runtimes['main']!.pods).not.toContain('input1')
  expect(written('workspace').slots).toEqual({ input1: { kind: 'pod', pod: 'nano.ui/input@edge/input1' } })
})

test('a pick into a runtime that has since gone places nothing', async () => {
  const h = await host()
  const { go, written, input } = mount(h, {})
  go('workspace')
  pick.choice = { widget: input }; pick.runtime = 'gone'
  document.querySelector<HTMLElement>('.dock-empty')!.click()
  await tick(50)
  expect(h.data().pods['input1']).toBeUndefined()
  expect(written('workspace').slots).toEqual({})
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

test('a slot whose pod fails shows the reason in its panel; the others open', async () => {
  const h = await host()
  await place(h, 'locked', ['x'], 'nano.ui/input', { kind: 'rules', rules: [] })
  await place(h, 'main', ['input1'])
  const { go, panels } = mount(h, { workspace: page('Main', { x: pod('x', 'locked'), input1: pod('input1') }, 0) })
  go('workspace')
  await until(() => panels('workspace').length === 2 && panels('workspace').some(p => p.textContent!.includes('no rule allows it')))
  await until(() => running(h, 'input1'))
})

test('a page changed elsewhere (a slot added) shows it in the dock and opens it; one removed goes', async () => {
  const h = await host()
  await place(h, 'main', ['input1', 'input2'])
  const { go, put, written, panels } = mount(h, { workspace: page('Main', { input1: pod('input1') }, 0) })
  go('workspace')
  await until(() => panels('workspace').length === 1)
  put('workspace', page('Main', { input1: pod('input1'), input2: pod('input2'), notes: { kind: 'view', view: 'notes' } }, 0))
  await until(() => panels('workspace').length === 3)
  await until(() => running(h, 'input2'))
  put('workspace', page('Main', { input2: pod('input2') }, 0))
  await until(() => panels('workspace').length === 1)
  expect(written('workspace').slots).toEqual({ input2: { kind: 'pod', pod: 'nano.ui/input@main/input2' } })
})

test('closing a panel removes its slot, not its pod', async () => {
  const h = await host()
  await place(h, 'main', ['input1', 'input2'])
  const { go, written, dock } = mount(h, { workspace: page('Main', { input1: pod('input1'), input2: pod('input2') }, 0) })
  go('workspace')
  await until(() => dock('workspace').querySelectorAll('.dock-panel').length === 2)
  dock('workspace').setTemplate('two-cols')
  dock('workspace').querySelector<HTMLElement>('.tpl-remove')!.click()
  expect(Object.keys(written('workspace').slots).length).toBe(1)
  expect(Object.keys(h.data().pods)).toContain('input1')
  expect(Object.keys(h.data().pods)).toContain('input2')
})

test('the dock\'s state is its page\'s: its layout and template in the page\'s `layout.workspace`, its restore point in `meta.workspace`, nothing in localStorage', async () => {
  const h = await host()
  await place(h, 'main', ['input1'])
  const { go, written, dock } = mount(h, { workspace: page('Main', { input1: pod('input1') }, 0) })
  go('workspace')
  await until(() => dock('workspace').querySelectorAll('.dock-panel').length === 1)
  dock('workspace').save()
  expect(JSON.stringify(written('workspace').meta.workspace.saved)).toContain('"input1"')
  await until(() => JSON.stringify(written('workspace').layout.workspace).includes('"input1"'))
  dock('workspace').setTemplate('one')
  expect(written('workspace').layout.workspace.template.template).toBe('one')
  expect(localStorage.length).toBe(0)
})

/** A reload: the pages shown again from the Platform's document, on the same host. */
const reload = (h: H, from: ReturnType<typeof mount>, open = '') => { const pages = from.platform.document().doc.pages; document.body.innerHTML = ''; return mount(h, pages, open) }
const swapped = (d: Dock) => { const sel = d.querySelector<HTMLSelectElement>('.tpl-pos select')!; sel.value = sel.options[1]!.value; sel.dispatchEvent(new Event('change')) }
const order = (d: Dock) => d.arrangement().template?.order.map(p => p?.name)

test('every change is kept (ADR-0036): a move unsaved is there after a reload; Restore returns to what Save kept', async () => {
  const h = await host()
  await place(h, 'main', ['input1', 'input2'])
  const first = mount(h, { workspace: page('Main', { input1: pod('input1'), input2: pod('input2') }, 0) })
  first.go('workspace')
  await until(() => first.panels('workspace').length === 2)
  first.dock('workspace').setTemplate('two-cols')
  first.dock('workspace').save()
  swapped(first.dock('workspace'))
  expect(order(first.dock('workspace'))).toEqual(['input2', 'input1'])
  const again = reload(h, first)
  again.go('workspace')
  await until(() => again.panels('workspace').length === 2)
  expect(again.dock('workspace').template).toBe('two-cols')
  expect(order(again.dock('workspace'))).toEqual(['input2', 'input1'])
  again.dock('workspace').restore()
  expect(order(again.dock('workspace'))).toEqual(['input1', 'input2'])
})

test('Main\'s starting panel closed without saving stays closed after a reload', async () => {
  const h = await host()
  const first = mount(h, {}, 'notes')
  first.go('workspace')
  await until(() => first.panels('workspace').length === 1)
  expect(first.written('workspace').slots).toEqual({ notes: { kind: 'view', view: 'notes' } })
  first.dock('workspace').querySelector<HTMLElement>('.lm_close_tab')!.click()
  await until(() => Object.keys(first.written('workspace').slots).length === 0)
  const again = reload(h, first, 'notes')
  again.go('workspace')
  await tick()
  expect(again.panels('workspace').length).toBe(0)
})

test('a slot added to a visited page that is hidden opens its pod only when the page shows again', async () => {
  const h = await host()
  await place(h, 'main', ['input1', 'input2'])
  const { go, put, panels } = mount(h, { two: page('Two', { input1: pod('input1') }) })
  go('two')
  await until(() => running(h, 'input1'))
  go('workspace')
  put('two', page('Two', { input1: pod('input1'), input2: pod('input2') }))   // as a pod's HostOutline apply would
  await tick(30)
  expect(h.app.runtime('main').status('input2')).toEqual({ ok: true, value: 'not started' })
  go('two')
  await until(() => running(h, 'input2') && panels('two').length === 2)
})

test('a view slot this dock has no widget for is kept when the dock rewrites the slots', async () => {
  const h = await host()
  const other = { kind: 'view', view: 'other-front-end-view' } as const
  const { go, written, dock } = mount(h, { workspace: page('Main', { elsewhere: other, notes: { kind: 'view', view: 'notes' } }, 0) })
  go('workspace')
  await until(() => dock('workspace').querySelectorAll('.dock-panel').length === 1)
  dock('workspace').setTemplate('two-cols')   // a dock:layout
  expect(written('workspace').slots).toEqual({ elsewhere: other, notes: { kind: 'view', view: 'notes' } })
})

test('a pod that failed to open is opened on a later apply that lets the host in', async () => {
  const h = await host()
  await place(h, 'locked', ['x'], 'nano.ui/input', { kind: 'rules', rules: [] })
  const { go, panels } = mount(h, { workspace: page('Main', { x: pod('x', 'locked') }, 0) })
  go('workspace')
  await until(() => panels('workspace')[0]?.textContent === 'no rule allows it')
  const d = h.data()
  expect((await h.apply({ ...d, runtimes: { ...d.runtimes, locked: { ...d.runtimes['locked']!, policy: { kind: 'rules', rules: [{ allow: '*' }] } } } })).ok).toBe(true)
  await until(() => h.app.runtime('locked').status('x').ok && panels('workspace')[0]!.querySelector('.dock-fail') === null)
})

test('Restore brings back a pod panel closed after Save, and its slot: both are there after a reload (ADR-0036)', async () => {
  const h = await host()
  await place(h, 'main', ['input1', 'input2'])
  const first = mount(h, { workspace: page('Main', { input1: pod('input1'), input2: pod('input2') }, 0) })
  first.go('workspace')
  await until(() => first.panels('workspace').length === 2)
  first.dock('workspace').save()
  const tab = [...first.dock('workspace').querySelectorAll<HTMLElement>('.lm_tab')].find(t => t.querySelector('.lm_title')?.textContent === 'input1')!
  tab.querySelector<HTMLElement>('.lm_close_tab')!.click()
  await until(() => Object.keys(first.written('workspace').slots).join() === 'input2')
  first.dock('workspace').restore()
  await until(() => first.panels('workspace').length === 2)
  await until(() => Object.keys(first.written('workspace').slots).sort().join() === 'input1,input2')
  expect(first.written('workspace').slots.input1).toEqual({ kind: 'pod', pod: 'nano.ui/input@main/input1' })
  const again = reload(h, first)
  again.go('workspace')
  await until(() => again.panels('workspace').length === 2)
})

test('opening a pod not placed in the runtime named adds no panel and says so', async () => {
  const h = await host()
  await place(h, 'main', ['input1'])
  const { go, bus, dock, panels, written } = mount(h, {})
  go('workspace')
  await tick()
  const said: string[] = []
  bus.subscribe('dock:status', m => said.push((m.payload as { message: string }).message))
  const d = dock('workspace') as Dock & { openPod(pod: string, runtime?: string): void }
  d.openPod('input1', 'elsewhere'); d.openPod('nope', 'main')
  await tick()
  expect(panels('workspace').length).toBe(0)
  expect(written('workspace').slots).toEqual({})
  expect(said).toEqual(['input1 is not placed in elsewhere: nothing was opened.', 'nope is not placed in main: nothing was opened.'])
})
