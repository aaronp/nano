// Folders, list and reader in one registry, wired by subscriptions.
import { expect, test } from 'bun:test'
import { Components, Ops, Registries, Runtimes, type Op } from '@pritzlaff/nano-core'
import { Folders, List, Reader } from '../src'

test('in one registry, folders.selected → list.show and list.opened → reader.read: selecting Sent then opening a message shows it in the reader', async () => {
  const rt = Runtimes.create(Registries.create('page')), reg = rt.registry
  reg.add('folders', Components.instantiate(Folders)); reg.add('list', Components.instantiate(List)); reg.add('reader', Components.instantiate(Reader))
  reg.subscribe({ source: 'folders', op: Ops.key(Folders.ops.selected), listener: 'list', target: Ops.key(List.ops.show) })
  reg.subscribe({ source: 'list', op: Ops.key(List.ops.opened), listener: 'reader', target: Ops.key(Reader.ops.read) })
  const call = (id: string, op: Op, arg: unknown = null) => rt.call({ registry: 'page', instance: 'test' }, id, Ops.key(op), arg) as Promise<any>
  await call('folders', Folders.ops.select, 'sent')
  expect((await call('list', List.ops.folder)).value).toBe('sent')
  await call('list', List.ops.open, 'm5')
  expect((await call('reader', Reader.ops.message)).value.subject).toBe('Re: Quarterly plan')
})

test('the wiring fits: opened fits read, selected fits show', () => {
  expect(Ops.fits(List.ops.opened, Reader.ops.read)).toBe(true)
  expect(Ops.fits(Folders.ops.selected, List.ops.show)).toBe(true)
})
