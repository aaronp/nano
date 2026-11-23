// Step 2: the calculator's contract, an interface whose ops carry TypeBox schemas; the types come from them.
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'
import { Coord, Op, Schema } from '@pritzlaff/nano-core'

// #region contract
const ns = Coord.namespace('acme.calc')

const Operator = Type.Union([Type.Literal('+'), Type.Literal('-'), Type.Literal('*'), Type.Literal('/')])
const Sum = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number() }), 'Sum')
const Calculated = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number(), result: Type.Number() }), 'Calculated')

export const Calculator = ns.interface('Calculator', {
  calculate: Op.action(Sum, Calculated),
})
// #endregion contract

// #region types
type SumType = Static<typeof Sum>   // { a: number; op: '+' | '-' | '*' | '/'; b: number }
const sum: SumType = { a: 2, op: '+', b: 3 }
// #endregion types

export async function main(log: (line: string) => void) {
  // #region check
  const input = Calculator.ops.calculate.input!
  log(`${Calculator.coord} has ${Object.keys(Calculator.ops).join(', ')}`)
  log(`{ a: 2, op: '+', b: 3 } fits: ${Value.Check(input, sum)}`)
  log(`{ a: 2, op: '%', b: 3 } fits: ${Value.Check(input, { a: 2, op: '%', b: 3 })}`)
  // #endregion check
}
