import { test, expect } from 'bun:test'
import { Contexts } from '@composable/sdk'
import { chart, count, counter, log, mapIn, mapped, mapper, push, setValue, slider, valueChanged } from '../src'

test('slider → doubler → chart and slider → counter (routed); log sees every publication with its origin', async () => {
  const scope = Contexts.scope({ onError: e => { throw e } }), page = scope.context('page')
  const l = await scope.add('log', log)
  await scope.add('slider', slider)
  const d = await scope.add('doubler', mapper({ label: 'x2', fn: x => x * 2 }))
  const k = await scope.add('counter', counter({ every: 2 }))
  const c = await scope.add('chart', chart)
  scope.route('slider', valueChanged, 'doubler', mapIn)
  scope.route('slider', valueChanged, 'counter', count)
  scope.route('doubler', mapped, 'chart', push)

  for (const v of [10, 20, 30]) await page.call('slider', setValue, v)
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0))

  expect(d.state).toMatchObject({ input: 30, output: 60 })
  expect(c.state.points).toEqual([20, 40, 60])
  expect(k.state.n).toBe(3)
  const rows = l.state.rows.slice().reverse()
  expect(rows.map(r => `${r.from}:${r.op}:${JSON.stringify(r.payload)}<-${r.origin}@${r.depth}`)).toEqual([
    'slider:value-changed:10<-page@2', 'doubler:mapped:20<-page@4',
    'slider:value-changed:20<-page@2', 'doubler:mapped:40<-page@4', 'counter:reached:2<-page@4',
    'slider:value-changed:30<-page@2', 'doubler:mapped:60<-page@4',
  ])
})
