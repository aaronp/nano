import { expect, test } from 'bun:test'
import { Ops } from '@composable/core'
import { ComponentList as L } from '../src'
import { demo, page, tick } from './fixtures'

const setup = async () => {
  const p = page(); p.add('list', L)
  await p.call('list', L.ops.set, [demo.slider, demo.chart])
  return p
}

test('set, add and remove components', async () => {
  const { call, value, spy } = await setup()
  const removed = spy('list', L.ops.removed)
  expect((await value('list', L.ops.components)).map((c: any) => c.id)).toEqual(['slider', 'chart'])
  await call('list', L.ops.add, demo.doubler)
  expect('error' in await call('list', L.ops.add, demo.doubler)).toBe(true)   // ids are unique
  await call('list', L.ops.remove, 'slider'); await tick()
  expect((await value('list', L.ops.components)).map((c: any) => c.id)).toEqual(['chart', 'doubler'])
  expect(removed).toEqual(['slider'])
  expect('error' in await call('list', L.ops.remove, 'ghost')).toBe(true)
})

test('add and remove ops on a component', async () => {
  const { call, value } = await setup()
  const extra = Ops.sink('demo/chart', 'clear', demo.chart.ops[0]!.input!)
  await call('list', L.ops.addOp, { component: 'chart', op: extra })
  expect('error' in await call('list', L.ops.addOp, { component: 'chart', op: extra })).toBe(true)
  const chart = () => value('list', L.ops.components).then((cs: any[]) => cs.find(c => c.id === 'chart').ops.map((o: any) => o.name))
  expect(await chart()).toEqual(['push', 'clear'])
  await call('list', L.ops.removeOp, { component: 'chart', op: 'demo/chart/push' })
  expect(await chart()).toEqual(['clear'])
  expect('error' in await call('list', L.ops.removeOp, { component: 'chart', op: 'demo/chart/nope' })).toBe(true)
})

test('selecting publishes the component, and the op when one is picked', async () => {
  const { call, value, spy } = await setup()
  const comps = spy('list', L.ops.componentSelected), ops = spy('list', L.ops.opSelected)
  await call('list', L.ops.select, { component: 'slider' })
  await call('list', L.ops.select, { component: 'chart', op: 'demo/chart/push' }); await tick()
  expect(comps).toEqual(['slider', 'chart'])
  expect(ops).toEqual([{ component: 'chart', op: 'demo/chart/push' }])
  expect(await value('list', L.ops.selected)).toEqual({ component: 'chart', op: 'demo/chart/push' })
  expect('error' in await call('list', L.ops.select, { component: 'ghost' })).toBe(true)
})
