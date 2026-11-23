// Step 4: the Registry, what can be made: providers and their implementations, looked up by coordinate.
import { Type } from 'typebox'
import { Coord, Op, Registry, Schema } from '@pritzlaff/nano-core'

const ns = Coord.namespace('acme.calc')
const Operator = Type.Union([Type.Literal('+'), Type.Literal('-'), Type.Literal('*'), Type.Literal('/')])
const Sum = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number() }), 'Sum')
const Calculated = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number(), result: Type.Number() }), 'Calculated')
const Calculator = ns.interface('Calculator', { calculate: Op.action(Sum, Calculated) })

const calculator = Calculator.impl(ns.implementationId('calculator'))
  .make(() => ({
    async calculate({ a, op, b }) {
      if (op === '/' && b === 0) throw new Error('cannot divide by zero')
      const result = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
      return { a, op, b, result }
    },
  }))

export async function main(log: (line: string) => void) {
  // #region registry
  const provider = ns.provider([calculator])
  const registry = Registry.create()
  const added = registry.add(provider)
  if (!added.ok) throw new Error(added.fail.reason)
  // #endregion registry
  // #region lookup
  for (const p of registry.manifest().providers) log(`provider ${p.coord}: ${p.implementations.join(', ')}`)
  log(`${Calculator.coord} is made by ${registry.implementationsOf(Calculator.coord).map(i => i.coord).join(', ')}`)
  // #endregion lookup
}
