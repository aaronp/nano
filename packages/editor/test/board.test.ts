import { expect, test } from 'bun:test'
import { ConnectionBoard as B, connectionsOf, type Piece } from '../src'
import { demo, page } from './fixtures'

const [valueChanged, set] = demo.slider.ops as [any, any]
const map = demo.doubler.ops[0]!, push = demo.chart.ops[0]!, show = demo.meter.ops[0]!, write = demo.log.ops[0]!
const at = (c: number, r = 0) => ({ c, r })
const piece = (instance: string, op: any, c: number, r = 0): Piece => ({ instance, op, cell: at(c, r) })

test('a row slider → doubler → chart gives two connections', () => {
  expect(connectionsOf([piece('slider', valueChanged, 0), piece('doubler', map, 1), piece('chart', push, 2)])).toEqual([
    { source: 'slider', op: 'demo/slider/value-changed', listener: 'doubler', target: 'demo/doubler/map' },
    { source: 'doubler', op: 'demo/doubler/map', listener: 'chart', target: 'demo/chart/push' },
  ])
})

test('a brand does not fit its base; unknown takes anything; a gap or another row breaks the chain', () => {
  expect(connectionsOf([piece('slider', valueChanged, 0), piece('meter', show, 1)])).toEqual([])
  expect(connectionsOf([piece('slider', valueChanged, 0), piece('log', write, 1)])).toHaveLength(1)
  expect(connectionsOf([piece('slider', valueChanged, 0), piece('chart', push, 2)])).toEqual([])
  expect(connectionsOf([piece('slider', valueChanged, 0), piece('chart', push, 1, 1)])).toEqual([])
  expect(connectionsOf([piece('chart', push, 0), piece('slider', valueChanged, 1)])).toEqual([])   // a sink has no output
})

test('place, move and take off; occupied cells are refused and nothing changes', async () => {
  const { add, call, value } = page(); add('board', B)
  await call('board', B.ops.place, { instance: 'slider', op: valueChanged, cell: at(0) })
  await call('board', B.ops.place, { instance: 'chart', op: push, cell: at(2) })
  const before = await value('board', B.ops.pieces)
  expect('error' in await call('board', B.ops.place, { instance: 'doubler', op: map, cell: at(0) })).toBe(true)
  expect('error' in await call('board', B.ops.move, { from: at(2), to: at(0) })).toBe(true)
  expect(await value('board', B.ops.pieces)).toEqual(before)
  await call('board', B.ops.place, { instance: 'doubler', op: map, cell: at(1) })
  expect(await value('board', B.ops.connections)).toHaveLength(2)
  await call('board', B.ops.move, { from: at(2), to: at(5) })
  expect(await value('board', B.ops.connections)).toHaveLength(1)
  await call('board', B.ops.takeOff, at(1))
  expect(await value('board', B.ops.connections)).toEqual([])
  expect('error' in await call('board', B.ops.takeOff, at(9))).toBe(true)
})

test('one instance may be placed twice; removeInstance takes all its pieces off', async () => {
  const { add, call, value } = page(); add('board', B)
  await call('board', B.ops.set, [piece('slider', valueChanged, 0), piece('slider', set, 1), piece('chart', push, 2)])
  expect(await value('board', B.ops.connections)).toHaveLength(2)
  await call('board', B.ops.removeInstance, 'slider')
  expect((await value('board', B.ops.pieces)).map((p: Piece) => p.instance)).toEqual(['chart'])
})

test('cells are non-negative whole numbers, and set refuses two pieces on one cell', async () => {
  const { add, call, value } = page(); add('board', B)
  expect('error' in await call('board', B.ops.place, { instance: 'slider', op: valueChanged, cell: { c: -1, r: 0 } })).toBe(true)
  expect('error' in await call('board', B.ops.place, { instance: 'slider', op: valueChanged, cell: { c: 1.5, r: 0 } })).toBe(true)
  expect('error' in await call('board', B.ops.set, [piece('a', map, 0), piece('b', map, 0)])).toBe(true)
  await call('board', B.ops.place, { instance: 'slider', op: valueChanged, cell: at(0) })
  expect('error' in await call('board', B.ops.move, { from: at(0), to: { c: 0, r: -2 } })).toBe(true)
  expect(await value('board', B.ops.pieces)).toHaveLength(1)
})
