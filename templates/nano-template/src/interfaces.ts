// What the two pods offer. `Calculated` is both the calculator's event and the history's `save` input, on purpose: an
// event whose data has the same schema as an action's input can be piped to it.
import { Type } from 'typebox'
import { Coord, Schema, Op } from '@pritzlaff/nano-core'

const ns = Coord.namespace('acme.template')

// #region schemas
const Operator = Type.Union([Type.Literal('+'), Type.Literal('-'), Type.Literal('*'), Type.Literal('/')])
export const Sum = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number() }), 'Sum')
export const Calculated = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number(), result: Type.Number() }), 'Calculated')
// #endregion schemas

// #region calculator-interface
export const Calculator = ns.interface('Calculator', {
  calculate: Op.action(Sum, Calculated),
  calculated: Op.event(Calculated),
})
// #endregion calculator-interface
// #region history-interface
export const History = ns.interface('History', {
  save: Op.action(Calculated, Type.Null()),
  load: Op.action(Type.Null(), Type.Array(Calculated)),
})
// #endregion history-interface
