import { Type } from 'typebox'
import { Coord, type Fail } from '@pritzlaff/nano-core'
import { Calculator } from './interfaces.ts'

const ns = Coord.namespace('acme.template')

/** A thrown Error carrying a `fail` is that failure (here `invalid-input`), where any other throw is `threw`. */
const invalid = (reason: string) => Object.assign(new Error(reason), { fail: { type: 'invalid-input', reason } satisfies Fail })

/** `a op b`, published as `calculated`; division by zero fails. Config: `{ precision }`, the decimals to round to. */
// #region calculator
export const calculator = Calculator.impl(ns.implementationId('calculator'))
  .config(Type.Union([Type.Object({ precision: Type.Optional(Type.Integer({ minimum: 0, maximum: 15 })) }), Type.Undefined()]))
  .make(ctx => ({
    async calculate({ a, op, b }) {
      if (op === '/' && b === 0) throw invalid('division by zero')
      const exact = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
      const p = ctx.config?.precision
      const result = p === undefined ? exact : Number(exact.toFixed(p))
      await ctx.publish(Calculator.ops.calculated, { a, op, b, result })
      return { a, op, b, result }
    },
    async *calculated() {},   // published above, not yielded here
  }))
// #endregion calculator
