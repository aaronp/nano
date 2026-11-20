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
  expect(strs(r)).toEqual({ pages: { two: { slots: {} }, workspace: { slots: {}, meta: { title: 'Workspace', order: 0 } } } })
})

test('a stored document that failed to load: nothing migrated, nothing placed, Main alone', async () => {
  localStorage.setItem('workspace-starter.saved-workspaces', JSON.stringify([{ path: '/t', title: 'T' }]))
  const doc = { pods: {}, runtimes: {}, layout: { pages: [{ id: 'old', title: 'Old', slots: [] }] } }
  expect(strs(must(await bootPages(untouched, localStorage, doc, null, false)))).toEqual({ pages: { workspace: { slots: {}, meta: { title: 'Workspace', order: 0 } } } })
  localStorage.clear()
})
