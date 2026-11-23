// Step 10: what `make` is given: the NanoContext, to call, publish to and listen to other pods, and to clean up.
import { Type, type Static } from 'typebox'
import { AppDeployment, Application, Coord, Op, Pod, Registry, Schema, type NanoResult } from '@pritzlaff/nano-core'

const ns = Coord.namespace('acme.calc')
const Operator = Type.Union([Type.Literal('+'), Type.Literal('-'), Type.Literal('*'), Type.Literal('/')])
const Sum = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number() }), 'Sum')
const Calculated = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number(), result: Type.Number() }), 'Calculated')
const Calculator = ns.interface('Calculator', { calculate: Op.action(Sum, Calculated), calculated: Op.event(Calculated) })
const History = ns.interface('History', {
  save: Op.action(Calculated, Type.Null()),
  load: Op.action(Type.Null(), Type.Array(Calculated)),
})

const compute = ({ a, op, b }: Static<typeof Sum>) => op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
const text = (c: Static<typeof Calculated>) => `${c.a} ${c.op} ${c.b} = ${c.result}`
/** The value, or an Error carrying the failure (so a handler's result carries it too). */
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw Object.assign(new Error(r.fail.reason), { fail: r.fail }); return r.value }

// #region calculator
const calculator = (log: (line: string) => void) => Calculator.impl(ns.implementationId('calculator'))
  .needs({ history: History })
  .make(ctx => {
    log(`building ${ctx.self} in ${ctx.runtimes.join(', ')}`)
    const history = must(ctx.one(History))   // the one History a call edge from this pod names
    history.on(History.ops.save, ({ input }) => log(`${history.pod} saved ${text(input)}`))
    ctx.addOnCloseListener(({ reason }) => log(`${ctx.self} closed: ${reason}`))
    return {
      async calculate(sum) {
        const c = { ...sum, result: compute(sum) }
        await ctx.deps.history.save(c)   // sugar over ctx.one(History)
        await ctx.publish(Calculator.ops.calculated, c)
        return c
      },
      async *calculated() {},   // published above, not yielded here
    }
  })
// #endregion calculator

// #region raw
const raw = Calculator.impl(ns.implementationId('raw'))
  .make(ctx => ({
    async calculate(sum) {
      const c = { ...sum, result: compute(sum) }
      const history = must(ctx.one(History))   // looked up at each call, as deps.history is
      must(await history.call.save(c))           // call gives a result value; it never throws
      return c
    },
    async *calculated() {},
  }))
// #endregion raw

const history = History.impl(ns.implementationId('history')).make(() => {
  const saved: Static<typeof Calculated>[] = []
  return { async save(c) { saved.push(c) }, async load() { return saved } }
})

export async function main(log: (line: string) => void) {
  const registry = Registry.create(), calc = calculator(log)
  must(registry.add(ns.provider([calc, raw, history])))
  // #region deployment
  const deployment: AppDeployment = {
    pods: { calculator: Pod.lazy(calc), raw: Pod.lazy(raw), history: Pod.lazy(history) },
    runtimes: { main: { pods: ['calculator', 'raw', 'history'], subscriptions: [
      { kind: 'call', from: 'calculator', to: 'history' },
      { kind: 'call', from: 'raw', to: 'history' },
    ] } },
  }
  // #endregion deployment
  const app = must(await Application.create(must(AppDeployment.assemble(deployment, registry))))
  // #region use
  const main = app.runtime('main')
  await main.get(Calculator, { pod: 'calculator' }).calculate({ a: 2, op: '+', b: 3 })
  await main.get(Calculator, { pod: 'raw' }).calculate({ a: 6, op: '*', b: 7 })
  await app.close()
  // #endregion use
}
