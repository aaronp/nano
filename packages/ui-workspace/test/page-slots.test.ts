// A dock's panels as its page's slots, and engine state reconciled with slots (slots win): pure, over the data.
import { expect, test } from 'bun:test'
import { reconcile, slotsOf } from '../src/dock/page-slots.ts'

const runtimeOf = (pod: string) => ({ clock1: 'main', input1: 'side' } as Record<string, string>)[pod]
const comp = (widget: string, name?: string) => ({ type: 'component', componentState: name ? { widget, name } : { widget } })

test('slotsOf: a placed pod\'s panel is a pod slot, any other panel a view slot of its widget; one slot per id', () => {
  expect(slotsOf([{ widget: 'pod', name: 'clock1' }, { widget: 'notes' }, { widget: 'nano-ui-input', name: 'input1' }, { widget: 'notes' }, { widget: 'pod', name: 'gone' }], runtimeOf)).toEqual([
    { id: 'clock1', runtime: 'main', pod: 'clock1' },
    { id: 'notes', view: 'notes' },
    { id: 'input1', runtime: 'side', pod: 'input1' },
  ])
})

test('reconcile: entries with no slot are dropped (emptied containers too), slots the engine lacks are returned to add', () => {
  const engine = { settings: { x: 1 }, root: { type: 'row', content: [
    { type: 'stack', activeItemIndex: 1, content: [comp('pod', 'clock1'), comp('notes')] },
    { type: 'stack', content: [comp('pod', 'gone')] },
  ] } }
  const slots = [{ id: 'clock1', runtime: 'main', pod: 'clock1' }, { id: 'chart', view: 'chart' }]
  expect(reconcile(engine, slots)).toEqual({
    engine: { settings: { x: 1 }, root: { type: 'row', content: [{ type: 'stack', activeItemIndex: 0, content: [comp('pod', 'clock1')] }] } },
    add: [{ id: 'chart', view: 'chart' }],
  })
  expect(reconcile(engine, []).engine).toEqual({ settings: { x: 1 }, root: undefined })
})

test('reconcile: in a template, positions with no slot are emptied and parked ones dropped; the template\'s panels are what it has', () => {
  const template = { template: 'two-cols', order: [{ widget: 'pod', name: 'gone' }, { widget: 'notes' }], parked: [{ widget: 'pod', name: 'clock1' }, { widget: 'chart' }], dock: { root: comp('chart') } }
  const slots = [{ id: 'notes', view: 'notes' }, { id: 'clock1', runtime: 'main', pod: 'clock1' }, { id: 'x', view: 'x' }]
  expect(reconcile({ root: comp('notes'), template }, slots)).toEqual({
    engine: { root: comp('notes'), template: { template: 'two-cols', order: [null, { widget: 'notes' }], parked: [{ widget: 'pod', name: 'clock1' }], dock: { root: undefined } } },
    add: [{ id: 'x', view: 'x' }],
  })
  expect(reconcile(undefined, slots)).toEqual({ engine: {}, add: slots })
})
