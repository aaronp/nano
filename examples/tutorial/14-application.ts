// Step 14: the Application applies a new deployment while it runs, if its deployment policy says yes.
import { Type, type Static } from 'typebox'
import { AppDeployment, Application, Coord, Op, Pod, Registry, Schema, port, type DeploymentPolicy, type Fail, type NanoResult } from '@pritzlaff/nano-core'

const ns = Coord.namespace('acme.calc')
const Operator = Type.Union([Type.Literal('+'), Type.Literal('-'), Type.Literal('*'), Type.Literal('/')])
const Sum = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number() }), 'Sum')
const Calculated = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number(), result: Type.Number() }), 'Calculated')
const Calculator = ns.interface('Calculator', { calculate: Op.action(Sum, Calculated), calculated: Op.event(Calculated) })
const History = ns.interface('History', {
  save: Op.action(Calculated, Type.Null()),
  load: Op.action(Type.Null(), Type.Array(Calculated)),
})

const invalid = (reason: string) => Object.assign(new Error(reason), { fail: { type: 'invalid-input', reason } satisfies Fail })
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

const history = History.impl(ns.implementationId('history')).make(() => {
  const saved: Static<typeof Calculated>[] = []
  return { async save(c) { saved.push(c) }, async load() { return saved } }
})

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

export async function main(log: (line: string) => void) {
  const registry = Registry.create()
  must(registry.add(ns.provider([calculator, history])))
  const deployment: AppDeployment = {
    pods: { calculator: Pod.lazy(calculator) },
    runtimes: { main: { pods: ['calculator'], subscriptions: [] } },
  }
  // #region policy
  const deploymentPolicy: DeploymentPolicy = {
    isAllowed: ({ caller }) => caller === 'host' ? { approved: true } : { approved: false, reason: `${caller} may not deploy` },
  }
  const app = must(await Application.create(must(AppDeployment.assemble(deployment, registry)), { deploymentPolicy }))
  app.listen(e => { if (e.type === 'applied') log(`applied by ${e.caller}: added ${e.added.join(', ')}`) })
  // #endregion policy
  // #region apply
  const next = app.deployment()   // a copy: change it freely
  next.pods.history = Pod.lazy(history)
  next.runtimes.main!.pods.push('history')
  next.runtimes.main!.subscriptions.push({
    kind: 'pipe', from: 'calculator', source: port(Calculator, Calculator.ops.calculated), to: 'history', target: port(History, History.ops.save),
  })
  log(JSON.stringify(await app.apply(next, { caller: 'calculator' })))
  log(JSON.stringify(await app.apply(next)))
  // #endregion apply
  // #region use
  const main = app.runtime('main')
  await main.get(Calculator).calculate({ a: 2, op: '+', b: 3 })
  log(JSON.stringify(await main.get(History).load()))
  // #endregion use
  await app.close()
}
