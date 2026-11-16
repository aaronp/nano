/**
 * The todo template, in the order of its benefits: it just works as plain TypeScript; the runtime shows, swaps and
 * lets others hear what happens; and the whole configuration is data (`nano.json`).
 */
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Implementation, Provider, Registry, type AppEvent, type NanoResult } from '@pritzlaff/nano-core'
import { KeyValueStoreDef } from './kv/contract.ts'
import kv, { impls, inMemory } from './kv/memory.ts'
import { TodoListDef } from './todo/contract.ts'
import todo from './todo/kv.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const saved = async (): Promise<AppDeployment> => Bun.file(new URL('./nano.json', import.meta.url)).json()

let heard: KeyValueStoreDef.Path[] = []
/** Only for these tests: a pod that hears its store's `changed`. */
const watcher = Implementation.define('example.test/watcher', {
  provides: [],
  dependencies: { store: KeyValueStoreDef.api },
  make: ctx => {
    const s = ctx.one(KeyValueStoreDef.api)
    if (s.ok) s.value.on(KeyValueStoreDef.api.ops.changed, ({ key }) => { heard.push(key) })
    return []
  },
})

async function open() {
  const registry = Registry.create()
  for (const p of [kv, todo, Provider.define('example.test', [watcher])]) must(registry.add(p))
  return must(await Application.create(must(AppDeployment.assemble(await saved(), registry))))
}

test('1. it just works: app.get gives a plain TodoList, CRUD over the store', async () => {
  const todos = (await open()).get(TodoListDef.api)
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
  await app.get(TodoListDef.api).add('milk')
  const call = events.find(e => e.type === 'sent' && e.from === 'todos' && e.to === 'store')
  expect(call).toMatchObject({ kind: 'call', port: 'example.kv.KeyValueStore/put' })
  const done = events.find(e => e.type === 'delivered' && call?.type === 'sent' && e.id === call.id)
  expect(done).toMatchObject({ result: { ok: true } })
  expect(typeof (done as { ms: number }).ms).toBe('number')
})

test('2. the runtime: apply swaps the store for another implementation and the next call reaches it', async () => {
  const app = await open()
  const todos = app.get(TodoListDef.api)
  await todos.add('milk')
  const next = app.deployment()
  next.pods.store = { implementation: String(impls.backup), eager: false }
  must(await app.apply(next))
  expect(await todos.list()).toEqual([])   // the same plain object, now over the backup store
  await todos.add('eggs')
  expect((await todos.list()).map(t => t.title)).toEqual(['eggs'])
})

test('2. the runtime: a subscriber hears the store\'s changed', async () => {
  heard = []
  const app = await open()
  const next = app.deployment()
  next.pods.watch = { implementation: 'example.test/watcher', eager: true }
  next.runtimes.main!.pods.push('watch')
  next.runtimes.main!.subscriptions.push({ kind: 'call', from: 'watch', to: 'store' })
  must(await app.apply(next))
  const t = await app.get(TodoListDef.api).add('milk')
  await Bun.sleep(0)
  expect(heard).toEqual([['todos', t.id]])
})

test('3. configuration as data: the running app\'s deployment() round-trips through nano.json', async () => {
  const json = await saved()
  const app = await open()
  const { modules, ...rest } = json
  expect(app.deployment()).toEqual(rest)
  const again = JSON.parse(JSON.stringify(app.deployment()))
  const registry = Registry.create()
  for (const p of [kv, todo]) must(registry.add(p))
  const copy = must(await Application.create(must(AppDeployment.assemble(again, registry))))
  expect(copy.deployment()).toEqual(app.deployment())
  expect(modules).toEqual({ 'example.kv': './kv/memory.js', 'example.todo': './todo/kv.js' })
})

test('a store Fail reaches the todo caller as itself: with no store wired, add is not-found, not threw', async () => {
  const app = await open()
  const next = app.deployment()
  next.runtimes.main!.subscriptions = []
  must(await app.apply(next))
  const e = await app.get(TodoListDef.api).add('milk').catch(x => x)
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
