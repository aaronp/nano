import { expect, test } from 'bun:test'
import { main } from './12-isolation.ts'

test('step 12: a sandbox pod runs as the host isolates it; with no host to isolate it, it fails', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual([
    'isolate calculator: sandbox',
    '2 + 3 = 5',
    '{"ok":false,"fail":{"type":"invalid-input","reason":"no host for isolation sandbox"}}',
  ])
})
