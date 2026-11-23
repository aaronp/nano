// Step 7: the calculator publishes `calculated` after each calculation; the host listens.
import { Type } from 'typebox'
import { AppDeployment, Application, Coord, Op, Pod, Registry, Schema, type Fail, type NanoResult } from '@pritzlaff/nano-core'

const ns = Coord.namespace('acme.calc')
const Operator = Type.Union([Type.Literal('+'), Type.Literal('-'), Type.Literal('*'), Type.Literal('/')])
const Sum = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number() }), 'Sum')
const Calculated = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number(), result: Type.Number() }), 'Calculated')
// #region interface
const Calculator = ns.interface('Calculator', {
  calculate: Op.action(Sum, Calculated),
  calculated: Op.event(Calculated),
})
// #endregion interface

const invalid = (reason: string) => Object.assign(new Error(reason), { fail: { type: 'invalid-input', reason } satisfies Fail })

// #region calculator
const calculator = Calculator.impl(ns.implementationId('calculator'))
  .make(ctx => ({
    async calculate({ a, op, b }) {
      if (op === '/' && b === 0) throw invalid('division by zero')
      const result = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
      await ctx.publish(Calculator.ops.calculated, { a, op, b, result })
      return { a, op, b, result }
    },
    async *calculated() {},   // published above, not yielded here
  }))
// #endregion calculator

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

export async function main(log: (line: string) => void) {
  const registry = Registry.create()
  must(registry.add(ns.provider([calculator])))
  const deployment: AppDeployment = {
    pods: { calculator: Pod.lazy(calculator) },
    runtimes: { main: { pods: ['calculator'], subscriptions: [] } },
  }
  const app = must(await Application.create(must(AppDeployment.assemble(deployment, registry))))
  // #region listen
  const calc = app.runtime('main').get(Calculator)
  const heard = calc.calculated()   // listening from this line on
  await calc.calculate({ a: 2, op: '+', b: 3 })
  await calc.calculate({ a: 6, op: '*', b: 7 })
  for await (const c of heard) {
    log(`heard ${c.a} ${c.op} ${c.b} = ${c.result}`)
    if (c.op === '*') break   // stops listening
  }
  // #endregion listen
  // #region raw
  const events = app.runtime('main').subscribe(Calculator.ops.calculated)
  await app.call('main', 'calculator').calculate({ a: 1, op: '-', b: 4 })
  for await (const e of events) { log(JSON.stringify(e)); break }
  // #endregion raw
  await app.close()
}
