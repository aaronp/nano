/**
 * The todo app written at the call site. `AppDeployment.edit` resolves the store in `example.todo.backend` and creates the todo
 * list in `example.todo.frontend` over it, recording the pods, the call edge and the policy rule as data: the same `nano.json`
 * that is checked in, which can be created from, or applied to a running app.
 */
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, type AppEvent, type NanoResult, type RuntimeDeployment } from '@pritzlaff/nano-core'
import { KeyValueStoreDef } from '../kv/contract.ts'
import kv, { impls } from '../kv/memory.ts'
import { TodoListDef } from './todo/contract.ts'
import todo from './todo/kv.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const registry = Registry.create()
for (const p of [kv, todo]) must(registry.add(p))
const memory = kv.implementations.get(String(impls.memory))!
const todosKv = todo.implementations.get('example.todo/kv')!
const saved = async (): Promise<AppDeployment> => Bun.file(new URL('./nano.json', import.meta.url)).json()

/** backend lets the host subscribe from outside, and anything inside; nothing else, until an edge is created. */
const backendPolicy = (): RuntimeDeployment['policy'] => ({ kind: 'rules', rules: [
  { allow: 'subscribe', from: 'host', outside: true, toInterface: String(KeyValueStoreDef.api.coord) },
  { allow: '*', outside: false }, { allow: 'start', from: 'host', outside: true }, { deny: '*' }] })   // the host may start a pod here, to show its panel

/** The todo app, in code. */
function build(base: AppDeployment) {
  const d = AppDeployment.edit(base, registry)
  d.place(memory, { pod: 'todoStore', in: 'example.todo.backend' })
  d.resolve('example.todo.backend', KeyValueStoreDef.api).create(todosKv, { pod: 'todos', in: 'example.todo.frontend' })
  return d.deployment()
}
const empty = (): AppDeployment => ({ pods: {}, runtimes: { 'example.todo.frontend': { pods: [], subscriptions: [] }, 'example.todo.backend': { pods: [], subscriptions: [], policy: backendPolicy() } },
  modules: { 'example.kv': '../kv/memory.js', 'example.todo': './todo/kv.js' },
  layout: { slots: [{ id: 'todos', runtime: 'example.todo.frontend', pod: 'todos' }] } })

test('1. code gives the checked-in nano.json: the pods, the edge todos→store in backend, and the rule letting it in', async () => {
  expect(build(empty())).toEqual(await saved())
})

test('2. it runs: created from the built data, the todo list works and its store calls travel in backend', async () => {
  const app = must(await Application.create(must(AppDeployment.assemble(build(empty()), registry))))
  const calls: string[] = []
  app.listen((e: AppEvent) => { if (e.type === 'sent' && e.kind === 'call' && e.from === 'todos') calls.push(e.runtime) })
  await app.runtime('example.todo.frontend').get(TodoListDef.api).add('milk')
  expect((await app.runtime('example.todo.frontend').get(TodoListDef.api).list()).map(t => t.title)).toEqual(['milk'])
  expect(new Set(calls)).toEqual(new Set(['example.todo.backend']))
})

test('3. editing a running app: resolve the store, create todos over it, apply; the saved deployment carries the edge and rule', async () => {
  const start = AppDeployment.edit(empty(), registry)
  start.place(memory, { pod: 'todoStore', in: 'example.todo.backend' })
  const app = must(await Application.create(must(AppDeployment.assemble(start.deployment(), registry))))
  expect(app.runtime('example.todo.frontend').resolve(TodoListDef.api)).toMatchObject({ ok: false, reason: 'not-found' })
  const d = AppDeployment.edit(app.deployment(), registry)
  const todos = d.resolve('example.todo.backend', KeyValueStoreDef.api).create(todosKv, { pod: 'todos', in: 'example.todo.frontend' })
  expect([todos.runtime, todos.pod, todos.implementation]).toEqual(['example.todo.frontend', 'todos', 'example.todo/kv'])
  must(await app.apply(d.deployment()))
  expect((await app.runtime('example.todo.frontend').get(TodoListDef.api).add('eggs')).title).toBe('eggs')
  expect(app.deployment().runtimes['example.todo.backend']!.subscriptions).toEqual([{ kind: 'call', from: 'todos', to: 'todoStore' }])
  const policy = app.deployment().runtimes['example.todo.backend']!.policy
  expect(policy?.kind === 'rules' && policy.rules[0]).toEqual({ allow: ['call', 'subscribe'], from: 'todos', outside: true, toInterface: 'example.kv.KeyValueStore' })   // first: it wins
})

test('4. the rule is what lets it in: a pod given an edge to the store by hand, with no rule, is denied', async () => {
  const d = build(empty())
  d.pods.sneaky = { implementation: 'example.todo/kv', eager: false }
  d.runtimes['example.todo.frontend']!.pods.push('sneaky')
  d.runtimes['example.todo.backend']!.subscriptions.push({ kind: 'call', from: 'sneaky', to: 'todoStore' })
  const app = must(await Application.create(must(AppDeployment.assemble(d, registry))))
  await expect(app.runtime('example.todo.frontend').get(TodoListDef.api, { pod: 'sneaky' }).add('x')).rejects.toMatchObject({ fail: { type: 'denied' } })
  expect((await app.runtime('example.todo.frontend').get(TodoListDef.api, { pod: 'todos' }).add('y')).title).toBe('y')
})

test('5. resolving fails as a running app would: not-found, and not-unique with two providers', () => {
  const d = AppDeployment.edit(empty(), registry)
  const err = (f: () => unknown) => { try { f() } catch (e) { return (e as { fail: { type: string } }).fail.type } }
  expect(err(() => d.resolve('example.todo.backend', KeyValueStoreDef.api))).toBe('not-found')
  d.place(memory, { pod: 'todoStore', in: 'example.todo.backend' })
  d.place(kv.implementations.get(String(impls.backup))!, { pod: 'spare', in: 'example.todo.backend' })
  expect(err(() => d.resolve('example.todo.backend', KeyValueStoreDef.api))).toBe('not-unique')
})
