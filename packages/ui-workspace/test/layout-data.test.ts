import { expect, test } from 'bun:test'
import { layoutFromDock, slotsToOpen } from '../src/layout-data.ts'

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
