// Step 9: the calculator knows nothing of history; a pipe carries its `calculated` event to `history.save`.
import { Type, type Static } from 'typebox'
import { AppDeployment, Application, Coord, Op, Pod, Registry, Schema, port, type Fail, type NanoResult } from '@pritzlaff/nano-core'

const ns = Coord.namespace('acme.calc')
const Operator = Type.Union([Type.Literal('+'), Type.Literal('-'), Type.Literal('*'), Type.Literal('/')])
const Sum = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number() }), 'Sum')
// #region interfaces
const Calculated = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number(), result: Type.Number() }), 'Calculated')
const Calculator = ns.interface('Calculator', {
  calculate: Op.action(Sum, Calculated),
  calculated: Op.event(Calculated),
})
const History = ns.interface('History', {
  save: Op.action(Calculated, Type.Null()),
  load: Op.action(Type.Null(), Type.Array(Calculated)),
})
// #endregion interfaces

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
  // #region pipe
  const pipe = (target: string) => ({
    kind: 'pipe' as const, from: 'calculator', source: port(Calculator, Calculator.ops.calculated), to: 'history', target,
  })
  const deployment = (target: string): AppDeployment => ({
    pods: { calculator: Pod.lazy(calculator), history: Pod.lazy(history) },
    runtimes: { main: { pods: ['calculator', 'history'], subscriptions: [pipe(target)] } },
  })
  const app = must(await Application.create(must(AppDeployment.assemble(deployment(port(History, History.ops.save)), registry))))
  // #endregion pipe
  // #region use
  const main = app.runtime('main')
  await main.get(Calculator).calculate({ a: 2, op: '+', b: 3 })
  await main.get(Calculator).calculate({ a: 6, op: '*', b: 7 })
  log(JSON.stringify(await main.get(History).load()))
  // #endregion use
  await app.close()
  // #region refused
  const refused = AppDeployment.assemble(deployment(port(History, History.ops.load)), registry)
  if (!refused.ok) log(refused.fail.reason)
  // #endregion refused
}
