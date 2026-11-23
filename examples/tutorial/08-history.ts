// Step 8: the calculator keeps a history without holding a store: it needs a History and sends it `save` messages.
import { Type, type Static } from 'typebox'
import { AppDeployment, Application, Coord, Op, Pod, Registry, Schema, type Fail, type NanoResult } from '@pritzlaff/nano-core'

const ns = Coord.namespace('acme.calc')
const Operator = Type.Union([Type.Literal('+'), Type.Literal('-'), Type.Literal('*'), Type.Literal('/')])
const Sum = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number() }), 'Sum')
const Calculated = Schema.define(Type.Object({ a: Type.Number(), op: Operator, b: Type.Number(), result: Type.Number() }), 'Calculated')
const Calculator = ns.interface('Calculator', { calculate: Op.action(Sum, Calculated) })
// #region history-interface
const History = ns.interface('History', {
  save: Op.action(Calculated, Type.Null()),
  load: Op.action(Type.Null(), Type.Array(Calculated)),
})
// #endregion history-interface

const invalid = (reason: string) => Object.assign(new Error(reason), { fail: { type: 'invalid-input', reason } satisfies Fail })

// #region calculator
const calculator = Calculator.impl(ns.implementationId('calculator'))
  .needs({ history: History })
  .make(({ deps }) => ({
    async calculate({ a, op, b }) {
      if (op === '/' && b === 0) throw invalid('division by zero')
      const result = op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : a / b
      await deps.history.save({ a, op, b, result })   // a message to whichever History the call edge names
      return { a, op, b, result }
    },
  }))
// #endregion calculator

// #region histories
const text = (c: Static<typeof Calculated>) => `${c.a} ${c.op} ${c.b} = ${c.result}`

const memory = History.impl(ns.implementationId('memory')).make(() => {
  const saved: Static<typeof Calculated>[] = []
  return { async save(c) { saved.push(c) }, async load() { return saved } }
})

const logged = (log: (line: string) => void) => History.impl(ns.implementationId('logged')).make(() => {
  const saved: Static<typeof Calculated>[] = []
  return { async save(c) { log(`saved ${text(c)}`); saved.push(c) }, async load() { return saved } }
})
// #endregion histories

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

export async function main(log: (line: string) => void) {
  const registry = Registry.create(), loud = logged(log)
  must(registry.add(ns.provider([calculator, memory, loud])))
  for (const to of ['memory', 'logged']) {
    // #region deployment
    const deployment: AppDeployment = {
      pods: { calculator: Pod.lazy(calculator), memory: Pod.lazy(memory), logged: Pod.lazy(loud) },
      runtimes: { main: { pods: ['calculator', 'memory', 'logged'], subscriptions: [{ kind: 'call', from: 'calculator', to }] } },
    }
    // #endregion deployment
    const app = must(await Application.create(must(AppDeployment.assemble(deployment, registry))))
    // #region use
    const main = app.runtime('main')
    await main.get(Calculator).calculate({ a: 2, op: '+', b: 3 })
    await main.get(Calculator).calculate({ a: 6, op: '*', b: 7 })
    log(`${to}: ${(await main.get(History, { pod: to }).load()).map(text).join(', ')}`)
    // #endregion use
    await app.close()
  }
}
