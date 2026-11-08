import { test, expect } from 'bun:test'
import { Components, Systems } from '@composable/sdk'
import { debug, onEvent, setInput, submitted } from '../src'

test('debug widget runs headless: set-input, submit, table records the sender; on-event stays internal', async () => {
  const scope = Systems.create(), page = scope.register('page', Components.party())
  const d = await debug.create(); scope.register('debug', d)
  const { input, table } = d.children
  await page.call('debug', setInput, 'hello')
  expect(input.state.value).toBe('hello')
  await input.notify(submitted, input.state.value)
  await new Promise(r => setTimeout(r, 0))
  expect(table.state.rows.map(r => [r.from, r.data])).toEqual([['input', 'hello']])
  expect(debug.manifest.ops.map(o => o.name)).toEqual([submitted.name, setInput.name])
  expect((await page.call('debug', onEvent, 'x')).type).toBe('error')
})
