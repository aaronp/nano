import { expect, test } from 'bun:test'
import { main } from './09-pipe.ts'

test('step 9: the pipe saves each calculation; a pipe whose schemas differ is refused', async () => {
  const lines: string[] = []
  await main(l => lines.push(l))
  expect(lines).toEqual([
    '[{"a":2,"op":"+","b":3,"result":5},{"a":6,"op":"*","b":7,"result":42}]',
    'runtime main: calculator->history (acme.calc.Calculator/calculated to acme.calc.History/load): acme.calc.Calculator/calculated does not fit acme.calc.History/load',
  ])
})
