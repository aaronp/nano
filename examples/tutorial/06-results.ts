// Step 6: a call's result is a value: a success, or a failure. Division by zero is a failure, not an exception.
import { Type } from 'typebox'
import { AppDeployment, Application, Coord, Implementation, Op, Pod, Registry, Schema, failure, provide, success, type Fail, type NanoResult } from '@pritzlaff/nano-core'

const ns = Coord.namespace('acme.calc')
const Operator = Type.Union([Type.Literal('+'), Type.Literal('-'), Type.Literal('*'), Type.Literal('/')])
const Sum = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number() }), 'Sum')
const Calculated = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number(), result: Type.Number() }), 'Calculated')
const Calculator = ns.interface('Calculator', { calculate: Op.action(Sum, Calculated) })

// #region builder
/** An Error carrying `fail`: that failure, where any other throw is `threw`. */
const invalid = (reason: string) => Object.assign(new Error(reason), { fail: { type: 'invalid-input', reason } satisfies Fail })

const calculator = Calculator.impl(ns.implementationId('calculator'))
  .make(() => ({
    async calculate({ a, op, b }) {
      if (op === '/' && b === 0) throw invalid('division by zero')
      const result = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
      if (!Number.isFinite(result)) throw new Error('the result is too large')
      return { a, op, b, result }
    },
  }))
// #endregion builder

// #region raw-impl
const raw = Implementation.define(ns.implementationId('raw'), {
  provides: [Calculator],
  make: () => [provide(Calculator, {
    async calculate({ a, op, b }) {
      if (op === '/' && b === 0) return failure('invalid-input', 'division by zero')
      const result = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
      return success({ a, op, b, result })
    },
  })],
})
// #endregion raw-impl

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

export async function main(log: (line: string) => void) {
  const registry = Registry.create()
  must(registry.add(ns.provider([calculator, raw])))
  const deployment: AppDeployment = {
    pods: { calculator: Pod.lazy(calculator), raw: Pod.lazy(raw) },
    runtimes: { main: { pods: ['calculator', 'raw'], subscriptions: [] } },
  }
  const app = must(await Application.create(must(AppDeployment.assemble(deployment, registry))))
  // #region results
  const calc = app.call('main', 'calculator')
  log(JSON.stringify(await calc.calculate({ a: 2, op: '+', b: 3 })))
  log(JSON.stringify(await calc.calculate({ a: 1, op: '/', b: 0 })))
  log(JSON.stringify(await calc.calculate({ a: 1e308, op: '*', b: 10 })))
  // #endregion results
  // #region raw
  log(JSON.stringify(await app.call('main', 'raw').calculate({ a: 1, op: '/', b: 0 })))
  // #endregion raw
  await app.close()
}
