import { test, expect } from 'bun:test'
import { Scopes } from '@composable/sdk'
import { chart, count, counter, log, mapNumber, mapper, push, setValue, slider, valueChanged } from '../src'

test('slider → doubler → chart and slider → counter (routed); log sees every publication, grouped by correlation', async () => {
  const scope = Scopes.create({ onError: e => { throw e } }), page = scope.context('page')
  const l = await scope.add('log', log)
  await scope.add('slider', slider)
  const d = await scope.add('doubler', mapper({ label: 'x2', fn: x => x * 2 }))
  const k = await scope.add('counter', counter({ every: 2 }))
  const c = await scope.add('chart', chart)
  scope.route('slider', valueChanged, 'doubler', mapNumber)
  scope.route('slider', valueChanged, 'counter', count)
  scope.route('doubler', mapNumber, 'chart', push)

  for (const v of [10, 20, 30]) await page.call('slider', setValue, v)
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0))

  expect(d.state).toMatchObject({ input: 30, output: 60 })
  expect(c.state.points).toEqual([20, 40, 60])
  expect(k.state.n).toBe(3)
  const rows = l.state.rows.slice().reverse()
  expect(rows.map(r => `${r.from}:${r.op}:${JSON.stringify(r.payload)}`)).toEqual([
    'slider:value-changed:10', 'doubler:map:20',
    'slider:value-changed:20', 'counter:reached:2', 'doubler:map:40',
    'slider:value-changed:30', 'doubler:map:60',
  ])
  // Each page call is one trigger: everything it caused shares its correlation.
  const by = Object.groupBy(rows, r => r.correlation)
  expect(Object.values(by).map(g => g!.map(r => r.op))).toEqual([
    ['value-changed', 'map'], ['value-changed', 'reached', 'map'], ['value-changed', 'map'],
  ])
})
