// The demo's components and types, as data for the editor. Shared with the tests.
import { Ops, type Runtime } from '@composable/core'
import { Type } from 'typebox'
import { ComponentList, TypeList, brandOf, type Ids } from '../src'

const num = Type.Number({ title: 'number' }), meters = brandOf(num, 'Meters')

/** Slider, doubler, chart, a Meters meter (which doesn't fit a number), and a log that takes anything. */
export const demo = {
  slider: { id: 'slider', ops: [Ops.source('demo/slider', 'value-changed', num), Ops.action('demo/slider', 'set', num, num)] },
  doubler: { id: 'doubler', ops: [Ops.action('demo/doubler', 'map', num, num)] },
  chart: { id: 'chart', ops: [Ops.sink('demo/chart', 'push', num)] },
  meter: { id: 'meter', ops: [Ops.sink('demo/meter', 'show', meters)] },
  log: { id: 'log', ops: [Ops.sink('demo/log', 'write', Type.Unknown({ title: 'unknown' }))] },
}

/** Fills an editor's list and types with the demo. */
export async function seed(rt: Runtime, ids: Ids) {
  const me = { registry: rt.registry.id, instance: 'demo' }
  await rt.call(me, ids.list, Ops.key(ComponentList.ops.set), Object.values(demo))
  await rt.call(me, ids.types, Ops.key(TypeList.ops.set), [{ type: meters }])
}
