/**
 * The todo template, in the order of its benefits: it just works as plain TypeScript; the runtime shows, swaps and
 * lets others hear what happens; and the whole configuration is data (`nano.json`).
 */
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, port, type AppEvent, type NanoResult } from '@pritzlaff/nano-core'
import { KeyValueStoreDef } from '../kv/contract.ts'
import kv, { impls, inMemory } from '../kv/memory.ts'
import { TodoListDef } from './todo/contract.ts'
import todo, { todoList } from './todo/kv.ts'
import { observeCalls } from '../../packages/ui-workspace/src/observed-calls.ts'

const KV = KeyValueStoreDef.api
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const saved = async (): Promise<AppDeployment> => Bun.file(new URL('./nano.json', import.meta.url)).json()

async function open() {
  const registry = Registry.create()
  for (const p of [kv, todo]) must(registry.add(p))
  return must(await Application.create(must(AppDeployment.assemble(await saved(), registry))))
}

test('1. it just works: the frontend gives a plain TodoList, CRUD over the store', async () => {
  const todos = (await open()).runtime('example.todo.frontend').get(TodoListDef.api)
  const milk = await todos.add('milk')
  const eggs = await todos.add('eggs')
  expect(milk).toEqual({ id: milk.id, title: 'milk', done: false })
  expect((await todos.list()).map(t => t.title).sort()).toEqual(['eggs', 'milk'])
  expect(await todos.update({ id: milk.id, done: true })).toEqual({ ...milk, done: true })
  expect(await todos.update({ id: 'missing', done: true })).toBeNull()
  expect(await todos.remove(eggs.id)).toBe(true)
  expect(await todos.remove(eggs.id)).toBe(false)
  expect(await todos.list()).toEqual([{ ...milk, done: true }])
  const e = await todos.add(42 as unknown as string).catch(x => x)
  expect(e.fail.type).toBe('invalid-input')   // a Fail reaches a plain caller as a thrown Error carrying it
})

test('2. the runtime: the stream shows every todos → store call with its timing', async () => {
  const app = await open()
  const events: AppEvent[] = []
  app.listen(e => events.push(e))
  await app.runtime('example.todo.frontend').get(TodoListDef.api).add('milk')
  const call = events.find(e => e.type === 'sent' && e.kind === 'call' && e.from === 'todos' && e.to === 'todoStore')
  expect(call).toMatchObject({ kind: 'call', port: port(KV, KV.ops.put) })
  const done = events.find(e => e.type === 'delivered' && call?.type === 'sent' && e.id === call.id)
  expect(done).toMatchObject({ result: { ok: true } })
  expect(typeof (done as { ms: number }).ms).toBe('number')
})

test('2. the runtime: the frontend iterates items() as todos are added', async () => {
  const todos = (await open()).runtime('example.todo.frontend').get(TodoListDef.api)
  await todos.add('before')                 // before items() is called: unseen (items is hot)
  const it = todos.items()[Symbol.asyncIterator]()   // connected here, at the call
  await todos.add('milk')
  expect(await it.next()).toMatchObject({ done: false, value: { title: 'milk', done: false } })
  await it.return!()
})

test('2. the runtime: apply swaps the store for another implementation and the next call reaches it', async () => {
  const app = await open()
  const todos = app.runtime('example.todo.frontend').get(TodoListDef.api)
  await todos.add('milk')
  const next = app.deployment()
  next.pods.todoStore = { implementation: String(impls.backup), eager: false }
  must(await app.apply(next))
  expect(await todos.list()).toEqual([])   // the same plain object, now over the backup store
  await todos.add('eggs')
  expect((await todos.list()).map(t => t.title)).toEqual(['eggs'])
})

test('2. the runtime: a host subscriber to the store\'s put in backend gets { input, output }; the frontend cannot hear the store (subscribe throws not-found)', async () => {
  const app = await open()
  const back: unknown[] = [], front: unknown[] = []
  app.runtime('example.todo.backend').subscribe(KeyValueStoreDef.api.ops.put, call => { back.push(call) })
  expect(() => app.runtime('example.todo.frontend').subscribe(KeyValueStoreDef.api.ops.put, call => { front.push(call) })).toThrow('not-found')
  const t = await app.runtime('example.todo.frontend').get(TodoListDef.api).add('milk')
  await Bun.sleep(0)
  expect(back).toEqual([{ input: { key: ['todos', t.id], value: t }, output: null }])
  expect(front).toEqual([])
})

test('2. the runtime: after unsubscribing, a later put reaches only the subscriber still in place', async () => {
  const app = await open()
  const gone: unknown[] = [], kept: unknown[] = []
  const backend = app.runtime('example.todo.backend')
  const off = backend.subscribe(KeyValueStoreDef.api.ops.put, call => { gone.push(call.input.key) })
  backend.subscribe(KeyValueStoreDef.api.ops.put, call => { kept.push(call.input.key) })
  const todos = app.runtime('example.todo.frontend').get(TodoListDef.api)
  const milk = await todos.add('milk')
  off()
  const eggs = await todos.add('eggs')
  await Bun.sleep(0)
  expect(gone).toEqual([['todos', milk.id]])
  expect(kept).toEqual([['todos', milk.id], ['todos', eggs.id]])
})

test('3. configuration as data: the running app\'s deployment() round-trips through nano.json', async () => {
  const json = await saved()
  const app = await open()
  const { modules, layout: _layout, ...rest } = json   // the layout is the page's, not the running app's
  expect(app.deployment()).toEqual(rest)
  const again = JSON.parse(JSON.stringify(app.deployment()))
  const registry = Registry.create()
  for (const p of [kv, todo]) must(registry.add(p))
  const copy = must(await Application.create(must(AppDeployment.assemble(again, registry))))
  expect(copy.deployment()).toEqual(app.deployment())
  expect(modules).toEqual({ 'example.kv': '../kv/memory.js', 'example.todo': './todo/kv.js' })
})

test('a store Fail reaches the todo caller as itself: with no store wired, add is not-found, not threw', async () => {
  const app = await open()
  const next = app.deployment()
  next.runtimes['example.todo.backend']!.subscriptions = []
  must(await app.apply(next))
  const e = await app.runtime('example.todo.frontend').get(TodoListDef.api).add('milk').catch(x => x)
  expect(e.fail.type).toBe('not-found')
})

test('the store is plain TypeScript too: no nano, values copied, list in path order', async () => {
  const s = inMemory()
  const v = { n: 1 }
  await s.put({ key: ['a', 'b'], value: v })
  await s.put({ key: ['a'], value: 'top' })
  v.n = 2
  expect(await s.get(['a', 'b'])).toEqual({ n: 1 })
  expect(await s.get(['nope'])).toBeNull()
  expect((await s.list({ prefix: ['a'] })).map(e => e.key)).toEqual([['a'], ['a', 'b']])
  await s.delete(['a'])
  expect(await s.get(['a'])).toBeNull()
})

test('2. the runtime: todos lives in frontend; its store calls travel in backend, allowed by backend\'s rules', async () => {
  const app = await open()
  const events: AppEvent[] = []
  app.runtime('example.todo.backend').listen(e => events.push(e))
  const todos = app.runtime('example.todo.frontend').get(TodoListDef.api)
  await todos.add('milk')
  const sent = events.filter(e => e.type === 'sent' && e.from === 'todos' && e.to === 'todoStore')
  expect(sent.length).toBeGreaterThan(0)
  expect(sent.every(e => e.type === 'sent' && e.runtime === 'example.todo.backend')).toBe(true)
  const next = app.deployment()
  next.runtimes['example.todo.backend']!.policy = { kind: 'rules', rules: [{ deny: '*', from: 'todos' }, { allow: '*' }] }
  must(await app.apply(next))
  const e = await todos.add('eggs').catch(x => x)
  expect(e.fail.type).toBe('denied')
  expect(events.some(x => x.type === 'denied')).toBe(true)
})

test('the list keeps the order todos were added in, however fast they come', async () => {
  const todos = todoList(inMemory())
  for (const t of ['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h']) await todos.add(t)
  expect((await todos.list()).map(t => t.title)).toEqual(['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h'])
})

test('todos declares its calls; the refresh timer\'s store.list comes from the pod, not from an op', async () => {
  const registry = Registry.create()
  for (const p of [kv, todo]) must(registry.add(p))
  const app = must(await Application.create(must(AppDeployment.assemble(await saved(), registry))))
  const o = observeCalls(app, registry)
  await app.runtime('example.todo.frontend').get(TodoListDef.api).add('milk')
  const timerList = (c: ReturnType<typeof o.calls>[number]) => c.from === 'todos' && c.source === null && c.target === port(KV, KV.ops.list)
  for (const end = Date.now() + 3000; !o.calls().some(timerList);) {
    if (Date.now() > end) throw new Error('no store.list from the refresh timer within 3s')
    await new Promise(r => setTimeout(r, 20))
  }
  const calls = o.calls()
  expect(calls).toContainEqual(expect.objectContaining({ source: port(TodoListDef.api, TodoListDef.api.ops.add), target: port(KV, KV.ops.put), declared: true, seen: true }))
  expect(calls).toContainEqual(expect.objectContaining({ from: 'todos', source: null, target: port(KV, KV.ops.list), declared: false, seen: true }))
  await app.close()
})
