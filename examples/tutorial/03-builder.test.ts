import { expect, test } from 'bun:test'
import { main } from './03-builder.ts'

test('step 3: the builder and the raw form describe the same implementation', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual(['acme.calc/calculator provides acme.calc.Calculator', 'acme.calc/calculator provides acme.calc.Calculator'])
})
