// Step 12: a pod runs on the host or in a sandbox; the Application asks the host for a sandboxed pod's stand-in.
import { Type } from 'typebox'
import { AppDeployment, Application, Coord, Op, Pod, Registry, Schema, type Implementation, type Fail, type NanoResult } from '@pritzlaff/nano-core'

const ns = Coord.namespace('acme.calc')
const Operator = Type.Union([Type.Literal('+'), Type.Literal('-'), Type.Literal('*'), Type.Literal('/')])
const Sum = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number() }), 'Sum')
const Calculated = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number(), result: Type.Number() }), 'Calculated')
const Calculator = ns.interface('Calculator', { calculate: Op.action(Sum, Calculated) })

const invalid = (reason: string) => Object.assign(new Error(reason), { fail: { type: 'invalid-input', reason } satisfies Fail })
const calculator = Calculator.impl(ns.implementationId('calculator'))
  .make(() => ({
    async calculate({ a, op, b }) {
      if (op === '/' && b === 0) throw invalid('division by zero')
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
    pods: { calculator: Pod.lazy(calculator, { isolation: 'sandbox' }) },
    runtimes: { main: { pods: ['calculator'], subscriptions: [] } },
  }
  const runtimes = must(AppDeployment.assemble(deployment, registry))
  // #endregion deployment
  // #region isolate
  const isolate = (name: string, pod: Pod): Implementation => {
    log(`isolate ${name}: ${pod.isolation}`)
    return calculator   // a stand-in with the same coordinate; a real host's forwards each message to a frame
  }
  const app = must(await Application.create(runtimes, { isolate }))
  const { result } = await app.runtime('main').get(Calculator).calculate({ a: 2, op: '+', b: 3 })
  log(`2 + 3 = ${result}`)
  // #endregion isolate
  await app.close()
  // #region no-host
  const bare = must(await Application.create(runtimes))
  log(JSON.stringify(await bare.call('main', 'calculator').calculate({ a: 2, op: '+', b: 3 })))
  // #endregion no-host
  await bare.close()
}
