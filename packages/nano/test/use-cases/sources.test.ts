/** Use case 2, second part (spec: 2026-11-16-runtime-view-streams-design.md): a source is a method; `items` is an event. */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { AppDeployment, Application, Implementation, Interface, Op, Provider, Registry, type NanoResult } from '../../src/index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

const Todo = Type.Object({ title: Type.String() })
const Store = Interface.define('acme.Store', { put: Op.action(Type.Object({ key: Type.Array(Type.String()), value: Type.Any() }), Type.Null()) })
const Todos = Interface.define('acme.Todos', { add: Op.action(Type.String(), Type.Null()), items: Op.event(Todo) })
const sourced = Registry.create()
must(sourced.add(Provider.define('acme', [
  Implementation.define('acme/store', { provides: [Store], make: () => ({ async put() {} }) }),
  Implementation.define('acme/todos', { provides: [Todos], dependencies: { store: Store }, make: ctx => ({
    add: title => ctx.deps.store.put({ key: ['todos', title], value: { title } }),
    async *items() {
      const s = ctx.one(Store)
      if (s.ok) for await (const { input } of s.value.on(Store.ops.put)) if (input.key[0] === 'todos') yield input.value
    },
  }) }),
  Implementation.define('acme/broken', { provides: [Todos], make: () => ({
    async add() {},
    async *items() { throw new Error('boom') },
  }) }),
])))
const todoApp = (implementation: string) => {
  const d: AppDeployment = {
    pods: { store: { implementation: 'acme/store', eager: false }, todos: { implementation, eager: implementation === 'acme/todos' } },
    runtimes: { main: { pods: ['store', 'todos'], subscriptions: [{ kind: 'call', from: 'todos', to: 'store' }] } },
  }
  return Application.create(must(AppDeployment.assemble(d, sourced)), {})
}

test('Interface.Type gives items(): AsyncIterable<Todo>', () => {
  type Items = Interface.Type<typeof Todos>['items']
  const ok: Items extends () => AsyncIterable<{ title: string }> ? true : false = true
  const back: (() => AsyncIterable<{ title: string }>) extends Items ? true : false = true
  expect(ok && back).toBe(true)
})

test("a source method built from a listener is published as the pod's event (hot)", async () => {
  const app = must(await todoApp('acme/todos')), frontend = app.runtime('main')
  const todos = frontend.get(Todos)
  await todos.add('a')                                  // before items() is called: unseen (hot)
  const items = todos.items()[Symbol.asyncIterator]()   // connected here, at the call
  await todos.add('b')                                  // after the call, before the first next(): seen
  expect(await items.next()).toEqual({ done: false, value: { title: 'b' } })
  const late = todos.items()[Symbol.asyncIterator]()     // a second consumer, from after b
  await todos.add('c')
  expect(await late.next()).toEqual({ done: false, value: { title: 'c' } })
  await items.return!(); await late.return!()
})

test("a throwing source traces failure; the pod's actions still work", async () => {
  const app = must(await todoApp('acme/broken')), events: unknown[] = []
  app.listen(e => events.push(e))
  await app.runtime('main').get(Todos).add('x')   // builds todos (lazy here), whose items() throws
  await Bun.sleep(0)
  expect(events).toContainEqual({ type: 'failure', pod: 'todos', reason: 'items threw boom' })
  await expect(app.runtime('main').get(Todos).add('y')).resolves.toBeNull()
})

const Built = Interface.define('acme.Built', { add: Op.action(Type.String(), Type.Null()), items: Op.event(Todo) })
const built = Registry.create()
must(built.add(Provider.define('acme', [
  Built.impl('acme/ok').make(ctx => ({ async add(t) { await ctx.publish(Built.ops.items, { title: t }) }, async *items() {} })),
  Built.impl('acme/bad').make(() => ({ async add() {}, async *items() { throw new Error('boom') } })),
])))
const builtApp = (impl: string) => Application.create(must(AppDeployment.assemble({
  pods: { b: { implementation: impl, eager: false } }, runtimes: { main: { pods: ['b'], subscriptions: [] } } }, built)), {})

test('a builder-made impl: its async * source is run and traced like a plain make', async () => {
  const app = must(await builtApp('acme/bad')), events: unknown[] = []
  app.listen(e => events.push(e))
  await Bun.sleep(0)
  await app.runtime('main').get(Built).add('x')
  await Bun.sleep(0)
  expect(events).toContainEqual({ type: 'failure', pod: 'b', reason: 'items threw boom' })
})

test('a builder-made impl: its source publishes hot', async () => {
  const app = must(await builtApp('acme/ok'))
  const it = app.runtime('main').get(Built).items()[Symbol.asyncIterator]()
  const first = it.next()
  await Bun.sleep(0)
  await app.runtime('main').get(Built).add('a')
  expect((await first).value).toEqual({ title: 'a' })
  await it.return!()
})
