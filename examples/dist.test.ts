/** The build: each example's dist/<name>/ holds its own module files (the shared kv in dist/kv/) and a nano.json that loads and runs. */
import { beforeAll, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Application, AppDeployment, Registry, type NanoResult } from '@pritzlaff/nano-core'
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
import { ChatDef } from './chat/room/contract.ts'
import { TodoListDef } from './todo/todo/contract.ts'
import uiProvider from '@pritzlaff/nano-ui'
import { combine } from './scripts/combine.ts'

const dist = join(import.meta.dir, 'dist')
beforeAll(() => { if (!Bun.spawnSync(['bun', 'scripts/build.ts'], { cwd: import.meta.dir }).success) throw new Error('build failed') })

test('each built nano.json names module files in its own folder or the shared kv, and they exist', async () => {
  for (const name of ['todo', 'chat', 'auth']) {
    const { modules } = await Bun.file(join(dist, name, 'nano.json')).json() as { modules: Record<string, string> }
    for (const file of Object.values(modules)) {
      expect(file).toMatch(/^(\.\/[^/]+|\.\.\/kv\/example\.kv)\.js$/)
      expect(existsSync(join(dist, name, file))).toBe(true)
    }
  }
})

test('the built todo nano.json loads and runs', async () => {
  const app = await Application.load(Bun.pathToFileURL(join(dist, 'todo/nano.json')))
  const todos = app.runtime('example.todo.frontend').get(TodoListDef.api)
  await todos.add('milk')
  expect((await todos.list()).map(t => t.title)).toEqual(['milk'])
})

test('the built chat nano.json loads and runs', async () => {
  const room = (await Application.load(Bun.pathToFileURL(join(dist, 'chat/nano.json')))).runtime('example.chat.room')
  await room.get(ChatDef.api, { pod: 'alice' }).say('hi')
  expect((await room.get(ChatDef.api, { pod: 'bob' }).transcript()).map(m => m.text)).toEqual(['hi'])
})

test('every module a source nano.json names is in its built nano.json', async () => {
  for (const name of ['todo', 'chat', 'auth']) {
    const src = await Bun.file(join(import.meta.dir, name, 'nano.json')).json() as { modules?: Record<string, string> }
    const { modules } = await Bun.file(join(dist, name, 'nano.json')).json() as { modules: Record<string, string> }
    for (const key of Object.keys(src.modules ?? {})) expect(modules[key]).toBeString()
  }
})

test('with PUBLIC_URL, every built module is an https URL under it, where ui-workspace serves the examples', async () => {
  const out = join(import.meta.dir, '../node_modules/.cache/examples-public')
  const env = { ...process.env, PUBLIC_URL: 'https://owner.github.io/repo/' }
  if (!Bun.spawnSync(['bun', 'scripts/build.ts', out], { cwd: import.meta.dir, env }).success) throw new Error('build failed')
  const { modules } = await Bun.file(join(out, 'chat/nano.json')).json() as { modules: Record<string, string> }
  expect(modules).toEqual({
    'example.messaging': 'https://owner.github.io/repo/examples/chat/example.messaging.js',
    'example.chat': 'https://owner.github.io/repo/examples/chat/example.chat.js',
    'example.kv': 'https://owner.github.io/repo/examples/kv/example.kv.js',
  })
})

test('every bundle is stamped with the nano-core it was built with', async () => {
  const { version } = await Bun.file(join(import.meta.dir, '../packages/nano/package.json')).json()
  expect((await import(join(dist, 'kv/example.kv.js'))).built).toEqual({ '@pritzlaff/nano-core': version })
})

test('dist/nano.json is every example in one file: it loads, and holds each one\'s runtimes and pods', async () => {
  const all = await Bun.file(join(dist, 'nano.json')).json() as { pods: Record<string, unknown>; runtimes: Record<string, unknown>; modules: Record<string, string> }
  for (const name of ['todo', 'chat', 'auth', 'template']) {
    const one = await Bun.file(join(dist, name, 'nano.json')).json() as { pods: Record<string, unknown>; runtimes: Record<string, unknown> }
    expect(Object.keys(all.pods)).toEqual(expect.arrayContaining(Object.keys(one.pods)))
    for (const r of Object.keys(one.runtimes)) expect(Object.keys(all.runtimes)).toContain(r === 'main' ? 'acme.template.main' : r)
  }
  for (const file of Object.values(all.modules)) expect(existsSync(join(dist, file))).toBe(true)
  const registry = Registry.create()   // nano.ui/log (auth's) comes from the host, as in a workspace
  must(registry.add(uiProvider))
  for (const file of Object.values(all.modules)) must(registry.add((await import(join(dist, file))).default))
  const app = must(await Application.create(must(AppDeployment.assemble(all as never, registry))))
  const room = app.runtime('example.chat.room')
  await room.get(ChatDef.api, { pod: 'alice' }).say('hi')
  expect((await room.get(ChatDef.api, { pod: 'bob' }).transcript()).map(m => m.text)).toEqual(['hi'])
})

test('combining files whose pods or modules clash fails loudly', () => {
  const one = { pods: { store: { implementation: 'a/x', eager: false } }, runtimes: {}, modules: { a: './a/a.js' } }
  expect(() => combine({ x: one, y: { ...one, modules: {} } })).toThrow(/pod store/)
  expect(() => combine({ x: one, y: { pods: {}, runtimes: {}, modules: { a: './b/a.js' } } })).toThrow(/module a/)
  expect(combine({ x: one, y: { pods: {}, runtimes: {}, modules: { a: './a/a.js' } } }).modules).toEqual({ a: './a/a.js' })
})
