import { test, expect } from 'bun:test'
import { Contexts } from '@composable/sdk'
import { debug, onEvent, setInput, submitted } from '../src'

test('debug widget runs headless: set-input, submit, table records the sender; on-event stays internal', async () => {
  const scope = Contexts.scope(), page = scope.context('page')
  const { input, table } = (await scope.add('debug', debug)).children
  await page.call('debug', setInput, 'hello')
  expect(input.state.value).toBe('hello')
  await input.emit(submitted, input.state.value)
  await new Promise(r => setTimeout(r, 0))
  expect(table.state.rows.map(r => [r.from, r.data])).toEqual([['input', 'hello']])
  expect(debug.manifest.consumes.map(a => a.name)).toEqual([setInput.name])
  expect((await page.call('debug', onEvent, 'x')).type).toBe('error')
})
