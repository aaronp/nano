// Step 11: a pod is built eager (at once) or lazy (on its first need), and configured, its config checked by a schema.
import { Type } from 'typebox'
import { AppDeployment, Application, Coord, Op, Pod, Registry, Schema, type Fail, type NanoResult } from '@pritzlaff/nano-core'

const ns = Coord.namespace('acme.calc')
const Operator = Type.Union([Type.Literal('+'), Type.Literal('-'), Type.Literal('*'), Type.Literal('/')])
const Sum = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number() }), 'Sum')
const Calculated = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number(), result: Type.Number() }), 'Calculated')
const Calculator = ns.interface('Calculator', { calculate: Op.action(Sum, Calculated) })

// #region calculator
const Precision = Schema.define(Type.Object({ precision: Type.Integer({ minimum: 0, maximum: 15 }) }), 'Precision')

const invalid = (reason: string) => Object.assign(new Error(reason), { fail: { type: 'invalid-input', reason } satisfies Fail })
const calculator = (log: (line: string) => void) => Calculator.impl(ns.implementationId('calculator'))
  .config(Precision)
  .make(({ self, config }) => {
    log(`built ${self}, precision ${config.precision}`)
    return {
      async calculate({ a, op, b }) {
        if (op === '/' && b === 0) throw invalid('division by zero')
        const exact = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
        return { a, op, b, result: Number(exact.toFixed(config.precision)) }
      },
    }
  })
// #endregion calculator

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

export async function main(log: (line: string) => void) {
  const registry = Registry.create(), calc = calculator(log)
  must(registry.add(ns.provider([calc])))
  // #region deployment
  const deployment = (rounded: unknown): AppDeployment => ({
    pods: {
      fine: Pod.eager(calc, { config: { precision: 6 } }),   // built when the application starts
      rounded: Pod.lazy(calc, { config: rounded }),          // built on its first need
    },
    runtimes: { main: { pods: ['fine', 'rounded'], subscriptions: [] } },
  })
  // #endregion deployment
  // #region use
  const app = must(await Application.create(must(AppDeployment.assemble(deployment({ precision: 2 }), registry))))
  log('created')
  const main = app.runtime('main')
  for (const pod of ['fine', 'rounded']) log(`${pod}: 1 / 3 = ${(await main.get(Calculator, { pod }).calculate({ a: 1, op: '/', b: 3 })).result}`)
  await app.close()
  // #endregion use
  // #region refused
  const refused = AppDeployment.assemble(deployment({ precision: 'two' }), registry)
  if (!refused.ok) log(refused.fail.reason)
  // #endregion refused
  // #region raw
  log(JSON.stringify(Pod.lazy(calc, { config: { precision: 2 } })))
  // #endregion raw
}
