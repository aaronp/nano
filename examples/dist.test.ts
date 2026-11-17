/** The build: each example's dist/<name>/ holds its own module files (the shared kv in dist/kv/) and a nano.json that loads and runs. */
import { beforeAll, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Application } from '@pritzlaff/nano-core'
import { ChatDef } from './chat/room/contract.ts'
import { TodoListDef } from './todo/todo/contract.ts'

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
