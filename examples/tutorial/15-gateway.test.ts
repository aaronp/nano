import { expect, test } from 'bun:test'
import { main } from './15-gateway.ts'

test('step 15: one history placed in two runtimes is their only bridge, built once', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual([
    'built calculator',
    'built history',
    'built report',
    '2 calculations, total 47',
    'no pod provides acme.calc.Calculator in back',
    'runtime back: report->calculator: calculator is not placed here',
  ])
})
