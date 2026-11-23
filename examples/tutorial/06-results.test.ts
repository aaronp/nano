import { expect, test } from 'bun:test'
import { main } from './06-results.ts'

test('step 6: a success, a chosen failure, a throw, and the raw failure', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual([
    '{"ok":true,"value":{"a":2,"op":"+","b":3,"result":5}}',
    '{"ok":false,"fail":{"type":"invalid-input","reason":"division by zero"}}',
    '{"ok":false,"fail":{"type":"threw","reason":"the result is too large"}}',
    '{"ok":false,"fail":{"type":"invalid-input","reason":"division by zero"}}',
  ])
})
