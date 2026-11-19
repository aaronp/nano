// <workspace-dock>: adding splits the focused panel, else the largest. Ported from retired/test/dock-focus.test.ts.
import { expect, mock, test } from 'bun:test'
let choice: { widget: string } | null = null   // the picker, stubbed
mock.module('../src/components/picker.ts', () => ({ pick: async () => choice }))
const { mount, tick } = await import('./dock-setup.ts')

// adding splits the focused panel (else the largest): a new column beside a wide one, a new row below a tall one
const rect = (w: number, h: number) => ({ width: w, height: h, x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, toJSON() {} }) as DOMRect
const sized = (size: (el: Element) => DOMRect) => {
  const orig = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (this: Element) { return size(this) }
  return () => { Element.prototype.getBoundingClientRect = orig }
}

test('adding beside a wide focused panel makes a column; below a tall one, a row', async () => {
  const { dock, panel, down } = await mount()
  dock.addWidget('plain'); await tick()
  let restore = sized(() => rect(800, 400))
  down(panel(0)); dock.addWidget('plain'); await tick()
  restore()
  expect(dock.querySelectorAll('.lm_row > .lm_stack').length).toBe(2)
  restore = sized(() => rect(400, 800))
  down(panel(1)); dock.addWidget('plain'); await tick()
  restore()
  expect(dock.querySelectorAll('.lm_row > .lm_column > .lm_stack').length).toBe(2)
  expect(dock.querySelectorAll('.dock-panel').length).toBe(3)
})

test('with no panel focused, adding splits the largest', async () => {
  const { dock, panel } = await mount()
  const wide = sized(() => rect(800, 400))
  dock.addWidget('plain'); dock.addWidget('plain'); dock.addWidget('plain'); await tick()
  wide()
  expect(dock.querySelectorAll('.lm_row > .lm_stack').length).toBe(3)
  const big = panel(1)
  const restore = sized((el) => el.contains(big) && el.classList.contains('lm_stack') ? rect(400, 900) : rect(100, 100))
  dock.addWidget('plain'); await tick()
  restore()
  expect(big.closest('.lm_column')).not.toBeNull()
  expect(big.closest('.lm_column')!.querySelectorAll('.lm_stack').length).toBe(2)
})

const pickAt = async (b: Element) => { (b as HTMLElement).click(); await tick(); await tick() }

test("a panel header's + splits that panel for the picker's choice, focused; cancelled, nothing is added", async () => {
  const { dock, panel, down } = await mount()
  const wide = sized(() => rect(800, 400))
  dock.addWidget('plain'); dock.addWidget('plain'); await tick()
  wide()
  const first = panel(0), second = panel(1), header = second.closest('.lm_stack')!.querySelector('.lm_header')!
  down(first)   // focused: a plain add would split it
  choice = null; await pickAt(header.querySelector('.dock-split')!)
  expect(dock.querySelectorAll('.dock-panel').length).toBe(2)
  choice = { widget: 'shown' }
  const tall = sized(() => rect(400, 800))
  await pickAt(header.querySelector('.dock-split')!)
  tall()
  expect(dock.querySelectorAll('.dock-panel').length).toBe(3)
  const shown = dock.querySelector('x-shown')!.closest<HTMLElement>('.dock-panel')!, column = shown.closest('.lm_row > .lm_column')!
  expect(column.contains(second)).toBe(true); expect(column.contains(first)).toBe(false)   // below the second panel
  expect(document.activeElement).toBe(shown)
})

test('an empty dock shows one large +, which fills it', async () => {
  const { dock } = await mount()
  const empty = dock.querySelector<HTMLElement>('.dock-empty')!
  expect(empty.hidden).toBe(false)
  choice = { widget: 'plain' }; await pickAt(empty)
  expect(dock.querySelectorAll('.dock-panel').length).toBe(1)
  expect(empty.hidden).toBe(true)
})
