// <workspace-dock>'s template mode: its panels in a fixed layout, switchable back to the hand-made dock. See dock-setup.ts.
import { expect, test } from 'bun:test'
import { mount, tick } from './dock-setup.ts'
import { panelsInOrder } from '../src/lib/layout-templates.ts'

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

test('a template that does not fit the count is refused', async () => {
  const { bus, dock } = await mount(); dock.addWidget('plain'); await tick()
  expect(dock.setTemplate('grid')).toBe(false)
  expect(dock.template).toBe('dock')
  expect(bus.history().filter(m => m.topic === 'dock:status').length).toBe(1)
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

test('restore() re-enters a stored template with its swapped order', async () => {
  const { dock } = await two()
  dock.save(); dock.setTemplate('two-cols')
  const t = dock.arrangement().template!, order = [...t.order].reverse()
  localStorage.setItem(`${dock.getAttribute('storage-key')}.template`, JSON.stringify({ ...t, order }))
  dock.restore()
  expect(dock.template).toBe('two-cols')
  expect(dock.arrangement().template!.order).toEqual(order)
})

test('restore() with no stored template stays in the dock', async () => {
  const { dock } = await two()
  dock.save(); dock.restore()
  expect(dock.template).toBe('dock')
})
