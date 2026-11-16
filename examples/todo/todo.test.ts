/**
 * The todo example: a plain `TodoList` whose every call goes through a nano application, where `todos` reaches its
 * `store` only through the runtime. The store itself is plain TypeScript too, tested here without nano.
 */
import { expect, test } from 'bun:test'
import { Application, assemble, createRegistry, type AppDeployment, type AppEvent, type NanoResult } from '@pritzlaff/nano-core'
import kv, { inMemory, KeyValueStore } from './kv.ts'
import todo, { type TodoList } from './todo.ts'
import { handlers, plain } from './plain.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

async function open() {
  const registry = createRegistry()
  must(registry.add(kv))
  must(registry.add(todo))
  const deployment: AppDeployment = await Bun.file(new URL('./nano.json', import.meta.url)).json()
  const app = must(await Application.create(must(assemble(deployment, registry)), {}))
  return { app, todos: plain<TodoList>(() => app.call('main', 'todos')) }
}

test('inMemory, with no nano: put, get, list by prefix in path order, delete, values copied', async () => {
  const s = inMemory()
  const v = { n: 1 }
  await s.put({ key: ['a', 'b'], value: v })
  await s.put({ key: ['a'], value: 'top' })
  await s.put({ key: ['b'], value: true })
  v.n = 2
  expect(await s.get(['a', 'b'])).toEqual({ n: 1 })
  expect(await s.get(['nope'])).toBeNull()
  expect((await s.list({ prefix: ['a'] })).map(e => e.key)).toEqual([['a'], ['a', 'b']])
  expect((await s.list({ prefix: [] })).map(e => e.key)).toEqual([['a'], ['a', 'b'], ['b']])
  await s.delete(['a'])
  expect(await s.get(['a'])).toBeNull()
})

test('a TodoList is plain TypeScript, and every call goes through the application', async () => {
  const { todos } = await open()
  const milk = await todos.add('milk')
  const eggs = await todos.add('eggs')
  expect(milk).toEqual({ id: milk.id, title: 'milk', done: false })
  expect((await todos.list()).map(t => t.title).sort()).toEqual(['eggs', 'milk'])
  expect(await todos.update({ id: milk.id, done: true })).toEqual({ ...milk, done: true })
  expect(await todos.update({ id: 'missing', done: true })).toBeNull()
  expect(await todos.remove(eggs.id)).toBe(true)
  expect(await todos.remove(eggs.id)).toBe(false)
  expect(await todos.list()).toEqual([{ ...milk, done: true }])
})

test('todos reaches store only through the runtime: the stream records the call edge', async () => {
  const { app, todos } = await open()
  const seen: AppEvent[] = []
  app.listen(e => seen.push(e))
  await todos.add('milk')
  expect(seen.some(e => e.type === 'sent' && e.from === 'todos' && e.to === 'store' && e.kind === 'call')).toBe(true)
})

test('a Fail reaches a plain caller as a thrown Error carrying it', async () => {
  const { todos } = await open()
  const e = await todos.add(42 as unknown as string).catch(x => x)
  expect(e).toBeInstanceOf(Error)
  expect(e.fail.type).toBe('invalid-input')
})

test('a throwing plain method is a threw result', async () => {
  const h = handlers(KeyValueStore, { get: async () => { throw new Error('disk on fire') } })
  expect(await h.get(['a'])).toEqual({ ok: false, fail: { type: 'threw', reason: 'disk on fire' } })
})
