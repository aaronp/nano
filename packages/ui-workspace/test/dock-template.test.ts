// <workspace-dock>'s template mode: its panels in a fixed layout, switchable back to the hand-made dock. See dock-setup.ts.
import { expect, mock, test } from 'bun:test'
import { panelsInOrder, type PanelState } from '../src/lib/layout-templates.ts'
// the picker, stubbed: it resolves with `choice` and records what it was offered
let choice: PanelState | null = null, offered: PanelState[] | undefined
mock.module('../src/components/picker.ts', () => ({ pick: async (_: HTMLElement, o: { hidden?: PanelState[] }) => { offered = o.hidden; return choice && { state: choice } } }))
mock.module('../src/components/picker-grid.ts', () => ({ pickerGrid: (host: HTMLElement, o: { hidden?: PanelState[] }) => new Promise(r => { if (host.className === 'dock-empty') return void host.addEventListener('click', () => choice && r({ state: choice })); offered = o.hidden; const b = Object.assign(document.createElement('button'), { className: 'tpl-add' }); host.append(b); b.addEventListener('click', () => choice && r({ state: choice })) }) }))   // inline: a click picks `choice`
const { mount, tick } = await import('./dock-setup.ts')

const two = async () => { const m = await mount(); m.dock.addWidget('plain'); m.dock.addWidget('plain'); await tick(); return m }

test('two panels flip to two-cols and back to the same tree', async () => {
  const { dock } = await two()
  const before = JSON.stringify(dock.arrangement().root)
  expect(dock.setTemplate('two-cols')).toBe(true)
  expect(dock.querySelectorAll('.dock-template .tpl-pos').length).toBe(2)
  expect(dock.arrangement().template?.template).toBe('two-cols')
  expect(dock.setTemplate('dock')).toBe(true)
  expect(dock.querySelector('.dock-template')).toBeNull()
  expect(JSON.stringify(dock.arrangement().root)).toBe(before)
})

const n = async (k: number) => { const m = await mount(); for (let i = 0; i < k; i++) m.dock.addWidget('plain'); await tick(); return m }
const notice = (dock: HTMLElement) => dock.querySelector<HTMLElement>('.dock-notice')!
const positions = (dock: HTMLElement) => [...dock.querySelectorAll<HTMLElement>('.tpl-pos')]
const filled = (dock: HTMLElement) => positions(dock).filter(p => p.querySelector('.dock-panel')).length
const plus = async (el: Element) => { (el as HTMLElement).click(); await tick(); await tick() }

test('every layout switches: what does not fit is parked behind a notice; Bring back picks one that fits', async () => {
  const { dock } = await n(4)
  expect(dock.setTemplate('two-cols')).toBe(true)
  expect(filled(dock)).toBe(2)
  expect(dock.arrangement().template!.parked.length).toBe(2)
  expect(notice(dock).hidden).toBe(false)
  expect(notice(dock).textContent).toContain('2 panels hidden — Bring back')
  ;[...notice(dock).querySelectorAll('button')].find(b => b.textContent === 'Bring back')!.click()
  expect(dock.template).toBe('grid')
  expect(filled(dock)).toBe(4)
  expect(notice(dock).hidden).toBe(true)
})

test('with nothing parked the notice is not shown: Bring back, then a position emptied and refilled', async () => {
  const { dock } = await n(4)
  dock.setTemplate('two-cols')
  ;[...notice(dock).querySelectorAll('button')].find(b => b.textContent === 'Bring back')!.click()
  positions(dock)[0]!.querySelector<HTMLElement>('.tpl-remove')!.click()
  choice = { widget: 'plain' }; await plus(dock.querySelector('.tpl-add')!)
  expect(dock.arrangement().template!.parked).toEqual([])
  expect(getComputedStyle(notice(dock)).display).toBe('none')
})

test('the notice dismissed stays hidden until the parked count changes', async () => {
  const { dock } = await n(4)
  dock.setTemplate('two-cols')
  notice(dock).querySelector<HTMLElement>('[aria-label="Dismiss"]')!.click()
  expect(notice(dock).hidden).toBe(true)
  dock.setTemplate('two-rows')
  expect(notice(dock).hidden).toBe(true)
  dock.setTemplate('one')
  expect(notice(dock).textContent).toContain('3 panels hidden')
  expect(notice(dock).hidden).toBe(false)
  notice(dock).querySelector<HTMLElement>('[aria-label="Dismiss"]')!.click()
  dock.setTemplate('dock'); dock.setTemplate('one')   // a fresh entry: shown again
  expect(notice(dock).hidden).toBe(false)
})

test('an empty position\'s + fills it from the picker, focused; cancelled, nothing changes', async () => {
  const { dock } = await n(1)
  dock.setTemplate('two-cols')
  expect(dock.arrangement().template!.order).toEqual([{ widget: 'plain' }, null])
  choice = null; await plus(dock.querySelector('.tpl-add')!)
  expect(dock.arrangement().template!.order).toEqual([{ widget: 'plain' }, null])
  choice = { widget: 'shown' }; await plus(dock.querySelector('.tpl-add')!)
  expect(dock.querySelector('.tpl-add')).toBeNull()
  expect(dock.arrangement().template!.order[1]).toEqual({ widget: 'shown', name: 'inst-1' })
  expect(document.activeElement).toBe(positions(dock)[1]!.querySelector('.dock-panel'))
})

test('a Hidden choice in an empty position leaves the parked panels', async () => {
  const { dock } = await mount()
  dock.addWidget('plain'); dock.addWidget('shown'); await tick()
  dock.setTemplate('one')
  const parked = dock.arrangement().template!.parked as PanelState[]
  expect(parked).toEqual([{ widget: 'shown', name: 'inst-1' }])
  positions(dock)[0]!.querySelector<HTMLElement>('.tpl-remove')!.click()
  choice = parked[0]!; await plus(dock.querySelector('.tpl-add')!)
  expect(offered).toEqual(parked)
  expect(dock.arrangement().template!.parked).toEqual([])
  expect(dock.arrangement().template!.order).toEqual(parked)
})

test('✕ empties a position, its panel gone', async () => {
  const { dock } = await two()
  dock.setTemplate('two-cols')
  positions(dock)[0]!.querySelector<HTMLElement>('.tpl-remove')!.click()
  expect(dock.arrangement().template!.order).toEqual([null, { widget: 'plain' }])
  expect(dock.querySelectorAll('.dock-panel').length).toBe(1)
  expect(positions(dock)[0]!.querySelector('.tpl-add')).not.toBeNull()
})

test('adding from outside fills the first empty position; with none, the dock comes back with it', async () => {
  const { dock } = await n(1)
  dock.setTemplate('two-cols')
  dock.addWidget('shown'); await tick()
  expect(dock.template).toBe('two-cols')
  expect(filled(dock)).toBe(2)
  expect(document.activeElement).toBe(positions(dock)[1]!.querySelector('.dock-panel'))
  dock.addWidget('plain'); await tick()
  expect(dock.template).toBe('dock')
  expect(panelsInOrder(dock.arrangement().root).map(p => p.widget).sort()).toEqual(['plain', 'plain', 'shown'])
})

test('back to the dock: panels emptied in the template are gone, panels added there split in', async () => {
  const { dock } = await mount()
  dock.addWidget('shown'); dock.addWidget('plain'); await tick()
  dock.setTemplate('two-cols')
  positions(dock)[1]!.querySelector<HTMLElement>('.tpl-remove')!.click()
  choice = { widget: 'plain' }; await plus(dock.querySelector('.tpl-add')!)
  positions(dock)[0]!.querySelector<HTMLElement>('.tpl-remove')!.click()
  dock.setTemplate('dock'); await tick()
  expect(panelsInOrder(dock.arrangement().root)).toEqual([{ widget: 'plain' }])
  expect(dock.querySelectorAll('.dock-panel').length).toBe(1)
})

test('swapping positions reorders the panels', async () => {
  const { dock } = await mount()
  dock.addWidget('shown'); dock.addWidget('plain'); await tick()
  dock.setTemplate('two-cols')
  const order = dock.arrangement().template!.order
  const select = dock.querySelector<HTMLSelectElement>('.tpl-pos select')!
  select.value = '2'; select.dispatchEvent(new Event('change'))
  expect(dock.arrangement().template!.order).toEqual([...order].reverse())
  expect(dock.querySelectorAll('.dock-template .tpl-pos').length).toBe(2)
  expect(dock.querySelector('x-shown')!.closest<HTMLElement>('.tpl-pos')!.dataset['area']).toBe('2')
})

test('a swap moves the panels in place, mounting none again', async () => {
  const { dock } = await mount()
  dock.addWidget('shown'); dock.addWidget('plain'); await tick()
  dock.setTemplate('two-cols')
  const panels = [...dock.querySelectorAll('.dock-template .dock-panel')]
  const select = dock.querySelector<HTMLSelectElement>('.tpl-pos select')!
  select.value = '2'; select.dispatchEvent(new Event('change'))
  expect([...dock.querySelectorAll('.dock-template .dock-panel')]).toEqual(panels)
  expect([...dock.querySelectorAll<HTMLElement>('.tpl-pos')].map(p => [p.dataset['area'], p.querySelector('select')!.value])).toEqual([['2', '2'], ['1', '1']])
})

test('setTemplate(dock) in the dock keeps golden-layout as it is', async () => {
  const { dock } = await two()
  const panel = dock.querySelector('.dock-panel')
  expect(dock.setTemplate('dock')).toBe(true)
  expect(dock.querySelector('.dock-panel')).toBe(panel)
})

test('leaving a template with a position focused sends dock:focus null', async () => {
  const { dock, focus, down } = await mount()
  dock.addWidget('shown'); dock.addWidget('plain'); await tick()
  dock.setTemplate('two-cols')
  down(dock.querySelector('.tpl-pos x-shown')!); await tick()
  dock.setTemplate('dock'); await tick()
  expect(focus.at(-1)).toBeNull()
})

test('a reload in a template comes back in it, and flips back to the hand-made dock', async () => {
  const { dock } = await two()
  const before = JSON.stringify(dock.arrangement().root)
  dock.setTemplate('two-cols')
  document.body.innerHTML = ''; await tick()
  const { dock: again } = await mount(); await tick()
  expect(again.template).toBe('two-cols')
  expect(again.querySelectorAll('.dock-template .tpl-pos').length).toBe(2)
  expect(again.setTemplate('dock')).toBe(true)
  expect(JSON.stringify(again.arrangement().root)).toBe(before)
})

test('opening a pod panel in a template flips back to dock and adds it', async () => {
  const { dock } = await two()
  dock.setTemplate('two-cols')
  dock.addWidget('plain'); await tick()
  expect(dock.template).toBe('dock')
  expect(panelsInOrder(dock.arrangement().root).length).toBe(3)
})

test('clicking a position reports its instance as dock:focus', async () => {
  const { dock, focus, down } = await mount()
  dock.addWidget('shown'); dock.addWidget('plain'); await tick()
  dock.setTemplate('two-cols')
  down(dock.querySelector('.tpl-pos x-shown')!); await tick()
  expect(focus.at(-1)).toEqual({ system: 'host', instance: 'inst-1', widget: 'ws' })
})

test('restore() returns to the restore point: saved in a template, it re-enters it with its order (ADR-0036)', async () => {
  const { dock } = await two()
  dock.setTemplate('two-cols')
  const order = dock.arrangement().template!.order
  dock.save(); dock.setTemplate('dock'); dock.setTemplate('one')
  dock.restore()
  expect(dock.template).toBe('two-cols')
  expect(dock.arrangement().template!.order).toEqual(order)
})

test('restore() with no stored template stays in the dock', async () => {
  const { dock } = await two()
  dock.save(); dock.restore()
  expect(dock.template).toBe('dock')
})

test('entering a template, and the flip back on add, send dock:layout for the picker', async () => {
  const { bus, dock } = await two()
  const layouts = () => bus.history().filter(m => m.topic === 'dock:layout')
  let n = layouts().length
  dock.setTemplate('two-cols')
  expect(layouts().length).toBe(n + 1)
  expect(layouts().at(-1)!.payload).toEqual({ panels: 2 })
  n = layouts().length
  dock.setTemplate('dock')
  expect(layouts().length).toBeGreaterThan(n)
  dock.setTemplate('two-cols'); n = layouts().length
  dock.addWidget('plain')
  expect(layouts().slice(n).map(m => m.payload)).toContainEqual({ panels: 2 })   // the flip back, before the add's own
})

test('restore() in a template whose panels differ from the saved layout lands in the dock with the saved root', async () => {
  const { dock } = await mount()
  dock.addWidget('shown'); await tick(); dock.save()
  const saved = JSON.stringify(dock.arrangement().root)
  dock.addWidget('plain'); await tick(); dock.setTemplate('two-cols')
  dock.restore()
  expect(dock.template).toBe('dock')
  expect(JSON.stringify(dock.arrangement().root)).toBe(saved)
})

test('position headers show the palette title', async () => {
  const { dock } = await mount()
  dock.addWidget('shown'); dock.addWidget('plain'); await tick()
  dock.setTemplate('two-cols')
  expect([...dock.querySelectorAll('.tpl-head span')].map(s => s.textContent)).toEqual(['Shown', 'Plain'])
})

test('a Hidden tile another position has taken is not filled twice: the place stays empty and says so', async () => {
  const { dock } = await mount()
  for (let i = 0; i < 3; i++) dock.addWidget('shown')
  await tick(); dock.setTemplate('two-cols')
  for (const r of dock.querySelectorAll<HTMLElement>('.tpl-remove')) r.click()
  const parked = dock.arrangement().template!.parked as PanelState[]
  expect(parked.length).toBe(1); expect(positions(dock).every(p => p.classList.contains('empty'))).toBe(true)
  choice = parked[0]!
  const [a, b] = [...dock.querySelectorAll<HTMLElement>('.tpl-add')]
  await plus(a!); await plus(b!)
  expect(dock.arrangement().template!.order.filter(Boolean)).toEqual(parked)
  expect(dock.arrangement().template!.parked).toEqual([])
  expect(positions(dock)[1]!.classList.contains('empty')).toBe(true)
})
