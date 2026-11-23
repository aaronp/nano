import { expect, test } from 'bun:test'
import { main } from './10-context.ts'

test('step 10: make gets the context: one, on, deps (sugar over one), addOnCloseListener', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual(['building calculator in main', 'history saved 2 + 3 = 5', 'history saved 6 * 7 = 42', 'calculator closed: closed'])
})
