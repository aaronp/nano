// The Import dialog's choices, as pure edits of the fetched nano.json: its runtimes renamed, its pods' isolation by Trust.
import { expect, test } from 'bun:test'
import type { AppDeployment } from '@pritzlaff/nano-core'
import { renameRuntimes, suggestedName, trusted, validRuntimeId } from '../src/import-plan.ts'

const file = (): AppDeployment => ({
  pods: {
    a: { implementation: 'acme.template/timer', eager: false },
    b: { implementation: 'other.x/y', eager: false, isolation: 'sandbox' },
    c: { implementation: 'other.x/y', eager: false, isolation: 'isolated-sandbox' },
  },
  runtimes: { main: { pods: ['a'], subscriptions: [] }, side: { pods: ['b', 'c'], subscriptions: [{ kind: 'call', from: 'b', to: 'c' }] } },
  modules: { 'acme.template': './index.js', 'other.x': './x.js' },
  layout: { workspace: { root: 1 }, slots: [{ id: 'a', runtime: 'main', pod: 'a' }, { id: 'b', runtime: 'side', pod: 'b' }] },
})

test('renameRuntimes renames the runtime keys and the layout slots naming them; the rest is untouched', () => {
  const d = file(), out = renameRuntimes(d, { main: 'acme.template.main', side: 'side' })
  expect(Object.keys(out.runtimes)).toEqual(['acme.template.main', 'side'])
  expect(out.runtimes['acme.template.main']).toEqual(d.runtimes.main!)
  expect(out.runtimes.side).toEqual(d.runtimes.side!)
  expect(out.layout).toEqual({ workspace: { root: 1 }, slots: [{ id: 'a', runtime: 'acme.template.main', pod: 'a' }, { id: 'b', runtime: 'side', pod: 'b' }] })
  expect(out.pods).toEqual(d.pods)
  expect(d).toEqual(file())   // pure
})

test('renameRuntimes with no names, or a file without layout, changes nothing', () => {
  expect(renameRuntimes(file(), {})).toEqual(file())
  const { layout: _, ...bare } = file()
  expect(renameRuntimes(bare, { main: 'm' }).layout).toBeUndefined()
})

test('suggestedName is the provider namespace of the runtime’s first pod by modules order, then the runtime', () => {
  expect(suggestedName(file(), 'main')).toBe('acme.template.main')
  expect(suggestedName(file(), 'side')).toBe('other.x.side')
  const d = file(); d.runtimes.side!.pods = ['b', 'a']   // spans two: the first in modules order
  expect(suggestedName(d, 'side')).toBe('acme.template.side')
  expect(suggestedName({ ...file(), runtimes: { e: { pods: [], subscriptions: [] } } }, 'e')).toBe('e')
})

test('validRuntimeId: no /, whitespace or #, 1 to 64 chars', () => {
  for (const ok of ['acme.template.main', 'a']) expect(validRuntimeId(ok)).toBe(true)
  for (const bad of ['', 'a/b', 'a b', 'a#b', 'x'.repeat(65)]) expect(validRuntimeId(bad)).toBe(false)
})

test('trusted: sandboxed makes every pod isolated-sandbox; trusted makes host, but keeps a file’s sandbox or isolated-sandbox', () => {
  expect(Object.values(trusted(file(), 'sandboxed').pods).map(p => p.isolation)).toEqual(['isolated-sandbox', 'isolated-sandbox', 'isolated-sandbox'])
  expect(Object.values(trusted(file(), 'trusted').pods).map(p => p.isolation ?? 'host')).toEqual(['host', 'sandbox', 'isolated-sandbox'])
})
