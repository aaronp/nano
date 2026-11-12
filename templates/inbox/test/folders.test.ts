// The Folders component: a list of folders and the selected one; publishes `selected`.
import { Type } from 'typebox'
import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { component } from '@pritzlaff/nano-runes'
import { Folders } from '../src'

const Spy = component('test/spy', () => { const got: unknown[] = []; return { get got() { return got }, take: (x: unknown) => { got.push(x) } } }, { got: Type.Array(Type.Unknown(), { description: 'Everything taken' }), take: { in: Type.Unknown({ description: 'Anything' }), description: 'Takes a value' } })

function page() {
  const rt = Runtimes.create(Registries.create('page')), reg = rt.registry
  reg.add('f', Components.instantiate(Folders))
  reg.add('spy', Components.instantiate(Spy))
  reg.subscribe({ source: 'f', op: Ops.key(Folders.ops.selected), listener: 'spy', target: Ops.key(Spy.ops.take) })
  const call = (op: Op, arg: unknown = null) => rt.call({ registry: 'page', instance: 'test' }, 'f', Ops.key(op), arg) as Promise<any>
  return { call, value: async (op: Op) => (await call(op)).value, got: (reg.get('spy')!.value as { got: unknown[] }).got }
}

test('it starts with Inbox, Sent, Archive and inbox selected', async () => {
  const { value } = page()
  expect((await value(Folders.ops.folders)).map((f: { name: string }) => f.name)).toEqual(['Inbox', 'Sent', 'Archive'])
  expect(await value(Folders.ops.current)).toBe('inbox')
})

test('select publishes selected; an unknown folder is refused', async () => {
  const { call, value, got } = page()
  await call(Folders.ops.select, 'sent')
  expect(await value(Folders.ops.current)).toBe('sent'); expect(got).toEqual(['sent'])
  expect((await call(Folders.ops.select, 'trash')).error).toContain('trash')
  expect((await call(Folders.ops.select, 5)).error).toBeTruthy()
  expect(await value(Folders.ops.current)).toBe('sent'); expect(got).toEqual(['sent'])
})

test('setFolders replaces them, keeping the selection if it still exists', async () => {
  const { call, value, got } = page()
  await call(Folders.ops.setFolders, [{ id: 'inbox', name: 'In' }, { id: 'spam', name: 'Spam' }])
  expect(await value(Folders.ops.current)).toBe('inbox'); expect(got).toEqual([])
  await call(Folders.ops.setFolders, [{ id: 'spam', name: 'Spam' }])
  expect(await value(Folders.ops.current)).toBe('spam'); expect(got).toEqual(['spam'])
  expect((await call(Folders.ops.setFolders, [{ id: 'x' }])).error).toBeTruthy()
})

test('folder ids are bounded to 40 characters', async () => {
  const { call } = page()
  expect((await call(Folders.ops.select, 'x'.repeat(41))).error).toBeTruthy()
  expect((await call(Folders.ops.setFolders, [{ id: 'x'.repeat(41), name: 'Long' }])).error).toBeTruthy()
  expect((await call(Folders.ops.setFolders, [{ id: 'x'.repeat(40), name: 'Ok' }])).error).toBeFalsy()
})

test('setFolders refuses duplicate ids and an empty list, changing nothing', async () => {
  const { call, value, got } = page()
  expect((await call(Folders.ops.setFolders, [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }])).error).toContain('a')
  expect((await call(Folders.ops.setFolders, [])).error).toBeTruthy()
  expect((await value(Folders.ops.folders)).length).toBe(3); expect(await value(Folders.ops.current)).toBe('inbox'); expect(got).toEqual([])
})

test('config is the folders and the current one; configure replaces them; a bad config changes nothing', async () => {
  const a = page()
  await a.call(Folders.ops.setFolders, [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }]); await a.call(Folders.ops.select, 'y')
  const cfg = await a.value(Folders.ops.config)
  expect(cfg).toEqual({ folders: [{ id: 'x', name: 'X' }, { id: 'y', name: 'Y' }], current: 'y' })
  const b = page()
  expect((await b.call(Folders.ops.configure, cfg)).error).toBeUndefined()
  expect(await b.value(Folders.ops.config)).toEqual(cfg)
  for (const bad of [{ folders: [], current: '' }, { folders: cfg.folders, current: 'z' }, { folders: [cfg.folders[0], cfg.folders[0]], current: 'x' }, {}])
    expect((await b.call(Folders.ops.configure, bad)).error).toBeTruthy()
  expect(await b.value(Folders.ops.config)).toEqual(cfg)
})

test('config and configure share a schema', () => { expect(Ops.fits(Folders.ops.config, Folders.ops.configure)).toBe(true) })
