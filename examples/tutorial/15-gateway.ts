// Step 15: two runtimes share one pod, the history, placed in both: their app gateway, and the only thing they share.
import { Type, type Static } from 'typebox'
import { AppDeployment, Application, Coord, Op, Pod, Registry, Schema, port, type NanoResult } from '@pritzlaff/nano-core'

const ns = Coord.namespace('acme.calc')
const Operator = Type.Union([Type.Literal('+'), Type.Literal('-'), Type.Literal('*'), Type.Literal('/')])
const Sum = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number() }), 'Sum')
const Calculated = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number(), result: Type.Number() }), 'Calculated')
const Calculator = ns.interface('Calculator', { calculate: Op.action(Sum, Calculated), calculated: Op.event(Calculated) })
const History = ns.interface('History', {
  save: Op.action(Calculated, Type.Null()),
  load: Op.action(Type.Null(), Type.Array(Calculated)),
})
// #region report
const Report = ns.interface('Report', { summary: Op.action(Type.Null(), Type.String()) })

const report = Report.impl(ns.implementationId('report'))
  .needs({ history: History })
  .make(({ deps }) => ({
    async summary() {
      const all = await deps.history.load()
      return `${all.length} calculations, total ${all.reduce((t, c) => t + c.result, 0)}`
    },
  }))
// #endregion report

const calculator = Calculator.impl(ns.implementationId('calculator'))
  .make(ctx => ({
    async calculate({ a, op, b }) {
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
  must(registry.add(ns.provider([calculator, history, report])))
  // #region deployment
  const deployment: AppDeployment = {
    pods: { calculator: Pod.lazy(calculator), history: Pod.lazy(history), report: Pod.lazy(report) },
    runtimes: {
      front: { pods: ['calculator', 'history'], subscriptions: [{
        kind: 'pipe', from: 'calculator', source: port(Calculator, Calculator.ops.calculated), to: 'history', target: port(History, History.ops.save),
      }] },
      back: { pods: ['history', 'report'], subscriptions: [{ kind: 'call', from: 'report', to: 'history' }] },
    },
  }
  // #endregion deployment
  const app = must(await Application.create(must(AppDeployment.assemble(deployment, registry))))
  app.listen(e => { if (e.type === 'built') log(`built ${e.pod}`) })
  // #region use
  const front = app.runtime('front'), back = app.runtime('back')
  await front.get(Calculator).calculate({ a: 2, op: '+', b: 3 })
  await front.get(Calculator).calculate({ a: 6, op: '*', b: 7 })
  log(await back.get(Report).summary())
  // #endregion use
  // #region apart
  const found = back.resolve(Calculator)
  log(found.ok ? `found ${found.pod}` : found.fail.reason)
  await app.close()
  const reaching = { ...deployment.runtimes.back!, subscriptions: [{ kind: 'call' as const, from: 'report', to: 'calculator' }] }
  const refused = AppDeployment.assemble({ ...deployment, runtimes: { ...deployment.runtimes, back: reaching } }, registry)
  if (!refused.ok) log(refused.fail.reason)
  // #endregion apart
}
