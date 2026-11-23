import { expect, test } from 'bun:test'
import { main } from './01-plain.ts'

test('step 1 prints a sum and the division by zero', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual(['2 + 3 = 5', '1 / 0: cannot divide by zero'])
})
