/**
 * Two displays of the same todos are two pods and a pipe: listA's `items` feed listB's `put`. The layout places both,
 * engine-neutral (`slots`, `geometry`), so any host can show them side by side. Nothing pipes back from listB.
 */
import { expect, test } from 'bun:test'
import { Application } from '@pritzlaff/nano-core'
import type { LayoutData } from '@pritzlaff/nano-ui'
import { TodoListDef } from './todo/contract.ts'

const url = new URL('./side-by-side.json', import.meta.url)
const open = async () => {
  const app = await Application.load(url), front = app.runtime('example.todo.frontend')
  const a = front.get(TodoListDef.api, { pod: 'listA' }), b = front.get(TodoListDef.api, { pod: 'listB' })
  await a.list(); await b.list()   // builds both, and A's source behind the pipe
  return { app, a, b }
}
const titles = async (l: { list(): Promise<TodoListDef.Todo[]> }) => (await l.list()).map(t => t.title)
const settle = () => new Promise(r => setTimeout(r, 20))

test('it loads, and its slots name pods placed in their runtimes', async () => {
  const { app } = await open(), file = await Bun.file(url).json(), layout = file.layout as LayoutData
  expect(layout.slots!.map(s => s.pod)).toEqual(['listA', 'listB'])
  for (const s of layout.slots!) {
    expect(app.deployment().runtimes[s.runtime]!.pods).toContain(s.pod)
    expect(layout.geometry![s.id]).toBeDefined()
  }
})

test('adding to listA shows in listB, through the pipe', async () => {
  const { a, b } = await open()
  await a.add('milk'); await settle()
  expect(await titles(b)).toEqual(['milk'])
})

test('updating in listA updates listB', async () => {
  const { a, b } = await open()
  const t = await a.add('milk'); await a.update({ id: t.id, done: true }); await settle()
  expect((await b.list()).map(x => [x.title, x.done])).toEqual([['milk', true]])
})

test('listB is not piped back: adding to listB leaves listA alone', async () => {
  const { a, b } = await open()
  await b.add('eggs'); await settle()
  expect(await titles(a)).toEqual([])
})
