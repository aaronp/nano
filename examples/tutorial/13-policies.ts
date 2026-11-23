// Step 13: a runtime's policy says yes or no to each message; here only the calculator may save to the history.
import { Type, type Static } from 'typebox'
import { AppDeployment, Application, Coord, Op, Pod, PolicyRules, Registry, Schema, port, type NanoResult, type Rule } from '@pritzlaff/nano-core'

const ns = Coord.namespace('acme.calc')
const Operator = Type.Union([Type.Literal('+'), Type.Literal('-'), Type.Literal('*'), Type.Literal('/')])
const Sum = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number() }), 'Sum')
const Calculated = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number(), result: Type.Number() }), 'Calculated')
const Calculator = ns.interface('Calculator', { calculate: Op.action(Sum, Calculated) })
const History = ns.interface('History', {
  save: Op.action(Calculated, Type.Null()),
  load: Op.action(Type.Null(), Type.Array(Calculated)),
})

const calculator = Calculator.impl(ns.implementationId('calculator'))
  .needs({ history: History })
  .make(({ deps }) => ({
    async calculate({ a, op, b }) {
      const result = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
      await deps.history.save({ a, op, b, result })
      return { a, op, b, result }
    },
  }))

const history = History.impl(ns.implementationId('history')).make(() => {
  const saved: Static<typeof Calculated>[] = []
  return { async save(c) { saved.push(c) }, async load() { return saved } }
})

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

export async function main(log: (line: string) => void) {
  const registry = Registry.create()
  must(registry.add(ns.provider([calculator, history])))
  // #region rules
  const rules: Rule[] = [
    { allow: 'call', from: 'calculator', toPort: port(History, History.ops.save) },
    { deny: 'call', toPort: port(History, History.ops.save) },
    { allow: '*' },
  ]
  // #endregion rules
  const deployment: AppDeployment = {
    pods: { calculator: Pod.lazy(calculator), history: Pod.lazy(history) },
    runtimes: { main: { pods: ['calculator', 'history'], subscriptions: [{ kind: 'call', from: 'calculator', to: 'history' }] } },
  }
  // #region policies
  const app = must(await Application.create(must(AppDeployment.assemble(deployment, registry)), { policies: { main: PolicyRules(rules) } }))
  const main = app.runtime('main')
  log(`2 + 3 = ${(await main.get(Calculator).calculate({ a: 2, op: '+', b: 3 })).result}`)   // its save: rules[0]
  log(JSON.stringify(await app.call('main', 'history').save({ a: 1, op: '+', b: 1, result: 3 })))   // the host: rules[1]
  log(JSON.stringify(await main.get(History).load()))                                     // allowed: rules[2]
  // #endregion policies
  await app.close()
  // #region raw
  const data: AppDeployment = { ...deployment, runtimes: { main: { ...deployment.runtimes.main!, policy: { kind: 'rules', rules } } } }
  const saved = must(await Application.create(must(AppDeployment.assemble(data, registry))))
  log(JSON.stringify(await saved.call('main', 'history').save({ a: 1, op: '+', b: 1, result: 3 })))
  // #endregion raw
  await saved.close()
}
