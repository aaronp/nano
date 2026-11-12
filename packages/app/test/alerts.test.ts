import { expect, test } from 'bun:test'
import { Components } from '@pritzlaff/nano-core'
import { alerts, AlertsOps } from '../src/alerts'
import { page } from './fixtures'

test('a missing alerts contract is a clear error', async () => {
  const t = page()
  const r = await t.call('alerts', AlertsOps.show, { message: 'hi' })
  expect(r.error).toBeString()
})

test('a registered alerts contract receives show', async () => {
  const t = page(), got: unknown[] = []
  t.reg.add('alerts', Components.instantiate(alerts(x => { got.push(x) })))
  await t.call('alerts', AlertsOps.show, { message: 'hi', tone: 'error' })
  expect(got).toEqual([{ message: 'hi', tone: 'error' }])
})
