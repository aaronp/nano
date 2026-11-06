import { test, expect } from 'bun:test'
import { Scopes } from '@composable/sdk'
import { debug, onEvent, setInput, submitted } from '../src'

test('debug widget runs headless: set-input, submit, table records the sender; on-event stays internal', async () => {
  const scope = Scopes.create(), page = scope.context('page')
  const { input, table } = (await scope.add('debug', debug)).children
  await page.call('debug', setInput, 'hello')
  expect(input.state.value).toBe('hello')
  await input.publish(submitted, input.state.value)
  await new Promise(r => setTimeout(r, 0))
  expect(table.state.rows.map(r => [r.from, r.data])).toEqual([['input', 'hello']])
  expect(debug.manifest.ops.map(o => o.name)).toEqual([submitted.name, setInput.name])
  expect((await page.call('debug', onEvent, 'x')).type).toBe('error')
})
