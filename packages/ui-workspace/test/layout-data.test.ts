import { expect, test } from 'bun:test'
import { dockPlacements, layoutFromDock, savedLayout, slotsToOpen } from '../src/layout-data.ts'

const panel = (name: string) => ({ type: 'stack', content: [{ type: 'component', componentState: { widget: 'pod', name } }] })
const main = () => 'main'

test('a dock of two side-by-side panels gives two slots and half-width boxes', () => {
  expect(layoutFromDock({ type: 'row', content: [panel('input1'), panel('log1')] }, main)).toEqual({
    slots: [{ id: 'input1', runtime: 'main', pod: 'input1' }, { id: 'log1', runtime: 'main', pod: 'log1' }],
    geometry: { input1: { x: 0, y: 0, w: 0.5, h: 1 }, log1: { x: 0.5, y: 0, w: 0.5, h: 1 } },
  })
})

test('an empty dock gives no slots', () => {
  expect(layoutFromDock(undefined, main)).toEqual({ slots: [], geometry: {} })
})

test('a panel whose pod is not placed is left out', () => {
  expect(layoutFromDock({ type: 'row', content: [panel('input1'), panel('gone')] }, p => p === 'gone' ? undefined : 'main').slots!.map(s => s.pod)).toEqual(['input1'])
})

test('opening: slots for placed pods, in order, only when the file has no workspace state', () => {
  const d = { pods: { a: {}, b: {} }, layout: { slots: [{ id: 'b', runtime: 'main', pod: 'b' }, { id: 'x', runtime: 'main', pod: 'missing' }, { id: 'a', runtime: 'main', pod: 'a' }] } }
  expect(slotsToOpen(d, 'workspace')).toEqual(['b', 'a'])
  expect(slotsToOpen({ ...d, layout: { ...d.layout, workspace: {} } }, 'workspace')).toEqual([])
  expect(slotsToOpen({ pods: {} }, 'workspace')).toEqual([])
})

test('savedLayout keeps the saved layout, the dock, its slots and the desk', () => {
  const desk = { boxes: {} } as never
  const out = savedLayout({ layout: { other: 1 } }, 'dock', { root: undefined }, main, desk) as any
  expect(out.other).toBe(1)
  expect(out.dock).toEqual({ root: undefined })
  expect(out.slots).toEqual([])
  expect(out.desk).toBe(desk)
  expect('desk' in (savedLayout({}, 'dock', { root: undefined }, main) as object)).toBe(false)
})

test("a dock's layout tree places its pods: rows and columns split by size, a stack is a tab group", () => {
  const c = (name?: string) => ({ type: 'component', componentState: name ? { widget: 'x', name } : { widget: 'notes' } })
  const root = { type: 'row', content: [
    { type: 'stack', size: 50, content: [c('r')] },
    { type: 'column', size: 50, content: [{ type: 'stack', size: 1, activeItemIndex: 1, content: [c('d'), c('l')] }, { type: 'stack', size: 3, content: [c()] }] },
  ] }
  expect(dockPlacements('/w', root)).toEqual([
    { screen: '/w', instance: 'r', box: { x: 0, y: 0, w: 0.5, h: 1 } },
    { screen: '/w', instance: 'd', box: { x: 0.5, y: 0, w: 0.5, h: 0.25 }, tab: { group: 'g1', active: false } },
    { screen: '/w', instance: 'l', box: { x: 0.5, y: 0, w: 0.5, h: 0.25 }, tab: { group: 'g1', active: true } },
  ])
})
