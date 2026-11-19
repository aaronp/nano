// The todo template, the runtime benefit: it shows, swaps and lets others hear what happens (see todo-setup.ts).
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry } from '@pritzlaff/nano-core'
import kv, { inMemory } from '../kv/memory.ts'
import { TodoListDef } from './todo/contract.ts'
import todo, { todoList } from './todo/kv.ts'
import { must, saved, open } from './todo-setup.ts'

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
test('the list keeps the order todos were added in, however fast they come', async () => {
  const todos = todoList(inMemory())
  for (const t of ['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h']) await todos.add(t)
  expect((await todos.list()).map(t => t.title)).toEqual(['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h'])
})
