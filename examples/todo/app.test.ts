/**
 * The todo app as its author writes it: load nano.json, get the plain TodoList, use it. Each failure here is a gap in
 * nano, fixed at the layer that owns it (spec: 2026-11-16-layer-map-design.md).
 */
import { expect, test } from 'bun:test'
import { Application } from '@pritzlaff/nano-core'
import { KeyValueStoreDef } from '../kv/contract.ts'
import { TodoListDef } from './todo/contract.ts'

test('load nano.json, enter the frontend, get the TodoList, it just works', async () => {
  const app = await Application.load(new URL('./nano.json', import.meta.url))
  const frontend = app.runtime('example.todo.frontend')
  const todos = frontend.get(TodoListDef.api)
  const milk = await todos.add('milk')
  expect(await todos.list()).toEqual([milk])
  expect(frontend.resolve(TodoListDef.api)).toMatchObject({ ok: true, pod: 'todos', runtime: 'example.todo.frontend' })
})

test('the frontend cannot reach the store; with two runtimes, app.get must be told which', async () => {
  const app = await Application.load(new URL('./nano.json', import.meta.url))
  expect(app.runtime('example.todo.frontend').resolve(KeyValueStoreDef.api)).toMatchObject({ ok: false, reason: 'not-found' })
  expect(app.resolve(TodoListDef.api)).toMatchObject({ ok: false, reason: 'not-unique' })
  expect(() => app.get(TodoListDef.api)).toThrow('not-unique')
  const next = app.deployment()
  next.runtimes['example.todo.frontend'] = { pods: ['todos', 'todoStore'], subscriptions: [], policy: { kind: 'rules', rules: [{ allow: ['call', 'subscribe'], outside: true, toInterface: String(TodoListDef.api.coord) }, { allow: '*', outside: false }, { deny: '*' }] } }
  if (!(await app.apply(next)).ok) throw new Error('apply')
  expect(app.runtime('example.todo.frontend').resolve(KeyValueStoreDef.api)).toMatchObject({ ok: false, reason: 'denied' })   // placed there, but the rules keep it from the host
  expect(() => app.runtime('example.todo.frontend').get(KeyValueStoreDef.api)).toThrow('denied')
})

test('resolve says why not, and getOrThrow throws an Error carrying the Fail', async () => {
  const app = await Application.load(new URL('./nano.json', import.meta.url))
  const missing = app.runtime('example.todo.frontend').resolve(TodoListDef.api, { pod: 'todoStore' })
  expect(missing.ok).toBe(false)
  expect(() => missing.getOrThrow()).toThrow()
  const e = (() => { try { missing.getOrThrow() } catch (x) { return x as { fail: { type: string } } } })()
  expect(e?.fail.type).toBe('not-found')
})

test('load fails with the first reason and leaves nothing running', async () => {
  const bad = new URL(`data:application/json,${encodeURIComponent(JSON.stringify({ pods: {}, runtimes: {}, modules: { x: './nope.js' } }))}`)
  await expect(Application.load(bad)).rejects.toThrow()
})
