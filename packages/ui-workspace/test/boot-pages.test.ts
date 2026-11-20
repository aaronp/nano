// boot-pages.ts: the pages to boot with (Main always there; nothing migrated when the stored document failed to load).
import { expect, test } from 'bun:test'
import type { NanoResult } from '@pritzlaff/nano-core'
import './host-deploy-setup.ts'

const { bootPages } = await import('../src/boot-pages.ts')
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const strs = (v: unknown) => JSON.parse(JSON.stringify(v))
const untouched = new Proxy({}, { get() { throw new Error('the host was used') } }) as never

test('stored pages saved without Main still boot with Main', async () => {
  const r = must(await bootPages(untouched, localStorage, null, { pages: { two: { slots: {} } } }))
  expect(strs(r)).toEqual({ roots: ['workspace', 'two'], pages: { two: { slots: {} }, workspace: { title: 'Workspace', slots: {} } } })
})

test('a stored document that failed to load: nothing migrated, nothing placed, Main alone', async () => {
  localStorage.setItem('workspace-starter.saved-workspaces', JSON.stringify([{ path: '/t', title: 'T' }]))
  const doc = { pods: {}, runtimes: {}, layout: { pages: [{ id: 'old', title: 'Old', slots: [] }] } }
  expect(strs(must(await bootPages(untouched, localStorage, doc, null, false)))).toEqual({ roots: ['workspace'], pages: { workspace: { title: 'Workspace', slots: {} } } })
  localStorage.clear()
})

test('stored pages with Main a child or not first boot repaired: Main the first root, its children kept, nothing else moved', async () => {
  const child = { roots: ['a'], pages: { a: { slots: {}, children: ['workspace', 'b'] }, workspace: { slots: {}, children: ['c'] }, b: { slots: {} }, c: { slots: {} } } }
  expect(strs(must(await bootPages(untouched, localStorage, null, child)))).toEqual({ roots: ['workspace', 'a'], pages: { a: { slots: {}, children: ['b'] }, workspace: { slots: {}, children: ['c'] }, b: { slots: {} }, c: { slots: {} } } })
  const second = { roots: ['a', 'workspace'], pages: { a: { slots: {} }, workspace: { slots: {} } } }
  expect(must(await bootPages(untouched, localStorage, null, second)).roots).toEqual(['workspace', 'a'])
})

test('stored flat pages with the old meta.workspace.order boot as a tree in that order, the order dropped', async () => {
  const old = { pages: { two: { title: 'Two', slots: {}, meta: { workspace: { order: 2, icon: 'star' } } }, workspace: { slots: {}, meta: { workspace: { order: 0 } } }, one: { slots: {}, meta: { workspace: { order: 1 } } } } }
  expect(strs(must(await bootPages(untouched, localStorage, null, old)))).toEqual({ roots: ['workspace', 'one', 'two'], pages: { two: { title: 'Two', slots: {}, meta: { workspace: { icon: 'star' } } }, workspace: { slots: {} }, one: { slots: {} } } })
})
