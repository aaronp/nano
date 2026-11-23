// Step 3: an implementation of the contract, written with the builder; the raw value it makes, beside it.
import { Type } from 'typebox'
import { Coord, Implementation, Op, Schema, failure, provide, success } from '@pritzlaff/nano-core'

const ns = Coord.namespace('acme.calc')
const Operator = Type.Union([Type.Literal('+'), Type.Literal('-'), Type.Literal('*'), Type.Literal('/')])
const Sum = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number() }), 'Sum')
const Calculated = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number(), result: Type.Number() }), 'Calculated')
const Calculator = ns.interface('Calculator', { calculate: Op.action(Sum, Calculated) })

// #region builder
export const calculator = Calculator.impl(ns.implementationId('calculator'))
  .make(() => ({
    async calculate({ a, op, b }) {
      if (op === '/' && b === 0) throw new Error('cannot divide by zero')
      const result = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
      return { a, op, b, result }
    },
  }))
// #endregion builder

// #region raw
export const raw = Implementation.define(ns.implementationId('calculator'), {
  provides: [Calculator],
  make: () => [provide(Calculator, {
    async calculate({ a, op, b }) {
      if (op === '/' && b === 0) return failure('threw', 'cannot divide by zero')
      const result = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
      return success({ a, op, b, result })
    },
  })],
})
// #endregion raw

export async function main(log: (line: string) => void) {
  // #region describe
  for (const impl of [calculator, raw]) log(`${impl.coord} provides ${impl.provides.map(i => i.coord).join(', ')}`)
  // #endregion describe
}
