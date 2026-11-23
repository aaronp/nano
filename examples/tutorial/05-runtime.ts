// Step 5: a Runtime places the calculator as a pod; the Application runs it, and the host calls it.
import { Type } from 'typebox'
import { AppDeployment, Application, Coord, Op, Pod, Registry, Schema, type NanoResult } from '@pritzlaff/nano-core'

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

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

export async function main(log: (line: string) => void) {
  const registry = Registry.create()
  must(registry.add(ns.provider([calculator])))
  // #region deployment
  const deployment: AppDeployment = {
    pods: { calculator: Pod.lazy(calculator) },
    runtimes: { main: { pods: ['calculator'], subscriptions: [] } },
  }
  const app = must(await Application.create(must(AppDeployment.assemble(deployment, registry))))
  // #endregion deployment
  // #region typed
  const { result } = await app.runtime('main').get(Calculator).calculate({ a: 2, op: '+', b: 3 })
  log(`2 + 3 = ${result}`)
  // #endregion typed
  // #region raw
  const r = await app.call('main', 'calculator').calculate({ a: 2, op: '+', b: 3 })
  log(JSON.stringify(r))
  // #endregion raw
  await app.close()
}
