import { expect, test } from 'bun:test'
import { main } from './11-pods.ts'

test('step 11: an eager pod is built at once, a lazy one on its first call; a config off its schema is refused', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual([
    'built fine, precision 6',
    'created',
    'fine: 1 / 3 = 0.333333',
    'built rounded, precision 2',
    'rounded: 1 / 3 = 0.33',
    'pod rounded: config does not fit Precision',
    '{"implementation":"acme.calc/calculator","config":{"precision":2},"eager":false}',
  ])
})
