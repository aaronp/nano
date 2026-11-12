import { expect, test } from 'bun:test'
import { placementsOf } from '../src/lib/dock-layout.ts'

test('placementsOf reads named panels from a saved layout', () => {
  const layout = { root: { type: 'row', content: [
    { type: 'component', componentType: 'widget', id: 'gauge', title: 'Gauge', componentState: { widget: 'range', name: 'r1' } },
    { type: 'stack', content: [{ type: 'component', componentType: 'widget', id: '', title: 'Log', componentState: { widget: 'log' } },
      { type: 'component', componentType: 'widget', id: '', title: 'Other', componentState: { widget: 'log', name: 'l1' } }] },
  ] } }
  expect(placementsOf(layout)).toEqual([{ panel: 'gauge', instance: 'r1' }, { panel: 'Other@0.1.1', instance: 'l1' }])
})

test('placementsOf of null or junk is []', () => {
  for (const junk of [null, undefined, 3, 'x', [], {}, { root: 5 }, { root: { type: 'row', content: 'no' } }]) expect(placementsOf(junk)).toEqual([])
})
