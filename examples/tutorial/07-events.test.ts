import { expect, test } from 'bun:test'
import { main } from './07-events.ts'

test('step 7: the host hears each calculated event, typed and raw', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual(['heard 2 + 3 = 5', 'heard 6 * 7 = 42', '{"output":{"a":1,"op":"-","b":4,"result":-3}}'])
})
