import { expect, test } from 'bun:test'
import { main } from './04-registry.ts'

test('step 4 prints the provider and what makes a Calculator', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual(['provider acme.calc: acme.calc/calculator', 'acme.calc.Calculator is made by acme.calc/calculator'])
})
