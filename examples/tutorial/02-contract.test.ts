import { expect, test } from 'bun:test'
import { main } from './02-contract.ts'

test('step 2 prints the interface and an input that fits and one that does not', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual([
    'acme.calc.Calculator has calculate',
    "{ a: 2, op: '+', b: 3 } fits: true",
    "{ a: 2, op: '%', b: 3 } fits: false",
  ])
})
