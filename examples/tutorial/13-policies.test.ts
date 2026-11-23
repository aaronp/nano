import { expect, test } from 'bun:test'
import { main } from './13-policies.ts'

test('step 13: the policy lets the calculator save and refuses the host, in code and as data', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual([
    '2 + 3 = 5',
    '{"ok":false,"fail":{"type":"denied","reason":"rules[1]"}}',
    '[{"a":2,"op":"+","b":3,"result":5}]',
    '{"ok":false,"fail":{"type":"denied","reason":"rules[1]"}}',
  ])
})
