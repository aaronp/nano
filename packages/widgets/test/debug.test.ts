import { test, expect } from 'bun:test'
import { Contexts, defineManifest, type Created } from '@composable/sdk'
import { debug, onEvent, setInput, submitted } from '../src'

test('debug widget runs headless: set-input, submit, table records the sender; on-event stays internal', async () => {
  const root = Contexts.bus({ self: { namespace: [], instance: 'root', manifest: defineManifest({ id: { author: 't', id: 'r' }, version: '0', emits: [], consumes: [] }) } })
  const inst = await root.register(debug, 'debug')
  const { input, table } = (root.component(inst) as Created<typeof debug>).children
  await root.call(inst, setInput, 'hello')
  expect(input.state.value).toBe('hello')
  await input.emit(submitted, input.state.value)
  await new Promise(r => setTimeout(r, 0))
  expect(table.state.rows.map(r => [r.from, r.data])).toEqual([['input', 'hello']])
  expect(debug.manifest.consumes.map(a => a.name)).toEqual([setInput.name])
  expect((await root.call(inst, onEvent, 'x')).type).toBe('error')
})
