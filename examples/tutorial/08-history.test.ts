import { expect, test } from 'bun:test'
import { main } from './08-history.ts'

test('step 8: the same calculator saves to whichever History its call edge names', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual(['memory: 2 + 3 = 5, 6 * 7 = 42', 'saved 2 + 3 = 5', 'saved 6 * 7 = 42', 'logged: 2 + 3 = 5, 6 * 7 = 42'])
})
