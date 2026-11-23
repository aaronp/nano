import { expect, test } from 'bun:test'
import { main } from './05-runtime.ts'

test('step 5 calls the placed calculator, typed and raw', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual(['2 + 3 = 5', '{"ok":true,"value":{"a":2,"op":"+","b":3,"result":5}}'])
})
