/**
 * The todo app as its author writes it: load nano.json, get the plain TodoList, use it. Each failure here is a gap in
 * nano, fixed at the layer that owns it (spec: 2026-11-16-layer-map-design.md).
 */
import { expect, test } from 'bun:test'
import { Application } from '@pritzlaff/nano-core'
import { TodoListDef } from './todo/contract.ts'

test('load nano.json, get the TodoList, it just works', async () => {
  const app = await Application.load(new URL('./nano.json', import.meta.url))
  const todos = app.get(TodoListDef.api)
  const milk = await todos.add('milk')
  expect(await todos.list()).toEqual([milk])
  expect(app.resolve(TodoListDef.api)).toMatchObject({ ok: true, pod: 'todos' })
})

test('resolve says why not, and getOrThrow throws an Error carrying the Fail', async () => {
  const app = await Application.load(new URL('./nano.json', import.meta.url))
  const missing = app.resolve(TodoListDef.api, { pod: 'store' })
  expect(missing.ok).toBe(false)
  expect(() => missing.getOrThrow()).toThrow()
  const e = (() => { try { missing.getOrThrow() } catch (x) { return x as { fail: { type: string } } } })()
  expect(e?.fail.type).toBe('not-found')
})

test('load fails with the first reason and leaves nothing running', async () => {
  const bad = new URL(`data:application/json,${encodeURIComponent(JSON.stringify({ pods: {}, runtimes: {}, modules: { x: './nope.js' } }))}`)
  await expect(Application.load(bad)).rejects.toThrow()
})
