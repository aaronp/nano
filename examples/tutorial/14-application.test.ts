import { expect, test } from 'bun:test'
import { main } from './14-application.ts'

test('step 14: the deployment policy refuses one apply and allows the next, which adds the history', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual([
    '{"ok":false,"fail":{"type":"denied","reason":"calculator may not deploy"}}',
    'applied by host: added history',
    '{"ok":true}',
    '[{"a":2,"op":"+","b":3,"result":5}]',
  ])
})
