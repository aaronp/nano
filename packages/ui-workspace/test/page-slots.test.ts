// A dock's panels as its page's slots, and engine state reconciled with slots (slots win): pure, over the data. A panel
// names its slot (`slot`; a layout from before that: its pod's name, else its widget).
import { expect, test } from 'bun:test'
import { Coord } from '@pritzlaff/nano-core'
import type { Slot } from '@pritzlaff/nano-outline'
import { reconcile, slotsOf } from '../src/dock/page-slots.ts'

const pod = (name: string, runtime = 'main'): Slot => ({ kind: 'pod', pod: Coord.pod(Coord.parse('implementation', 'nano.ui/input'), Coord.runtime(runtime), name) })
const select: Slot = { kind: 'select', select: { runtime: Coord.runtime('side') } }
const view = (v: string): Slot => ({ kind: 'view', view: v })
const kind = (w: string) => (({ pod: 'pod', 'nano-ui-input': 'pod', notes: 'view', chart: 'view' }) as Record<string, 'pod' | 'view'>)[w]
const strs = (v: unknown) => JSON.parse(JSON.stringify(v))
const comp = (widget: string, name?: string, slot?: string) => ({ type: 'component', componentState: { widget, ...(name && { name }), ...(slot && { slot }) } })

test('slotsOf: each slot a panel shows kept as it is (a select stays a select); a closed panel\'s dropped; a new view panel\'s added; one per id', () => {
  const slots = { a: pod('input1'), any: select, clock1: pod('clock1'), notes: view('notes'), elsewhere: view('other-front-end-view'), shut: view('chart') }
  const got = slotsOf([{ widget: 'pod', name: 'input1', slot: 'a' }, { widget: 'pod', name: 'log2', slot: 'any' }, { widget: 'pod', name: 'clock1' }, { widget: 'notes' }, { widget: 'notes' }, { widget: 'chart', slot: 'fresh' }, { widget: 'nano-ui-input' }], slots, kind)
  expect(got['any']).toBe(select)
  expect(strs(got)).toEqual(strs({ a: pod('input1'), any: select, clock1: pod('clock1'), notes: view('notes'), elsewhere: view('other-front-end-view'), fresh: view('chart') }))
  expect(Object.keys(got)).toEqual(['a', 'any', 'clock1', 'notes', 'elsewhere', 'fresh'])
})

test('slotsOf: a pod panel with no slot on the page adds none (a pick gets its slot first)', () => {
  expect(slotsOf([{ widget: 'pod', name: 'stray' }], {}, kind)).toEqual({})
})

test('reconcile: entries with no slot are dropped (emptied containers too), slots the engine lacks are returned to add', () => {
  const engine = { settings: { x: 1 }, root: { type: 'row', content: [
    { type: 'stack', activeItemIndex: 1, content: [comp('pod', 'clock1', 'c'), comp('notes')] },
    { type: 'stack', content: [comp('pod', 'gone')] },
  ] } }
  const slots = { c: pod('clock1'), chart: view('chart') }
  expect(reconcile(engine, slots)).toEqual({
    engine: { settings: { x: 1 }, root: { type: 'row', content: [{ type: 'stack', activeItemIndex: 0, content: [comp('pod', 'clock1', 'c')] }] } },
    add: [['chart', view('chart')]],
  })
  expect(reconcile(engine, {}).engine).toEqual({ settings: { x: 1 }, root: undefined })
  expect(reconcile(engine, { constructor: view('x') }).add).toEqual([['constructor', view('x')]])   // own keys only
})

test('reconcile: in a template, positions with no slot are emptied and parked ones dropped; the template\'s panels are what it has', () => {
  const template = { template: 'two-cols', order: [{ widget: 'pod', name: 'gone' }, { widget: 'notes' }], parked: [{ widget: 'pod', name: 'clock1' }, { widget: 'chart' }], dock: { root: comp('chart') } }
  const slots = { notes: view('notes'), clock1: pod('clock1'), x: view('x') }
  expect(reconcile({ root: comp('notes'), template }, slots)).toEqual({
    engine: { root: comp('notes'), template: { template: 'two-cols', order: [null, { widget: 'notes' }], parked: [{ widget: 'pod', name: 'clock1' }], dock: { root: undefined } } },
    add: [['x', view('x')]],
  })
  expect(reconcile(undefined, slots)).toEqual({ engine: {}, add: Object.entries(slots) })
})
