// The docks on the Outline: a drag is one `outline.apply` and no Application event; a slot whose pod was undeployed
// stays and shows "not found" with a remove button, and comes back when the pod does (Review Focus 2); a `select` slot
// shows its first match and how many matched, and stays a `select` when the dock rewrites the slots (Review Focus 3).
import { expect, test } from 'bun:test'
import { Coord } from '@pritzlaff/nano-core'
import type { Slot } from '@pritzlaff/nano-outline'
import { host, mount, page, place, pod, running, tick, undeploy, until } from './dock-pods-setup.ts'

type GL = { rootItem: { contentItems: { size: number }[] }; emit(e: string): void }

test('a drag is one outline.apply, of the page\'s layout alone, and no Application `applied`', async () => {
  const h = await host()
  await place(h, 'main', ['input1', 'input2'])
  const { go, dock, panels, outline, written } = mount(h, { workspace: page('Main', { a: pod('input1'), b: pod('input2') }) })
  go('workspace')
  await until(() => panels('workspace').length === 2 && running(h, 'input2'))
  await tick()
  const changes: unknown[] = [], events: string[] = [], slots = written('workspace').slots, was = JSON.stringify(written('workspace').layout)
  outline.listen(c => changes.push(c)); h.app.listen(e => events.push(e.type))
  const gl = (dock('workspace') as unknown as { layout: GL }).layout
  gl.rootItem.contentItems[0]!.size = 20; gl.rootItem.contentItems[1]!.size = 80   // the sizes a splitter drag leaves
  gl.emit('stateChanged')   // what golden-layout says when a drag ends
  expect(changes).toEqual([{ added: [], removed: [], changed: ['workspace'], moved: [], resolved: [] }])
  expect(JSON.stringify(written('workspace').layout)).not.toBe(was)
  expect(written('workspace').slots).toEqual(slots)
  await tick()
  expect(events.filter(t => t === 'applied')).toEqual([])
})

test('an undeployed pod\'s slot stays and shows "not found" with a remove button; redeployed, it shows again; Remove drops the slot (Review Focus 2)', async () => {
  const h = await host()
  await place(h, 'main', ['input1', 'input2'])
  const { go, panels, written } = mount(h, { workspace: page('Main', { a: pod('input1'), b: pod('input2') }) })
  go('workspace')
  await until(() => panels('workspace').length === 2 && running(h, 'input1'))
  await undeploy(h, 'input1')
  const gone = () => panels('workspace').find(p => p.textContent!.includes('not found'))
  await until(() => !!gone()?.querySelector('button'))
  expect(Object.keys(written('workspace').slots)).toEqual(['a', 'b'])   // kept: desired state
  await place(h, 'main', ['input1'])
  await until(() => !gone() && running(h, 'input1'))
  expect(panels('workspace').length).toBe(2)
  await undeploy(h, 'input1')
  await until(() => !!gone())
  expect(gone()!.querySelector('[role="status"]')!.textContent).toBe('a: not found')
  const remove = gone()!.querySelector('button')!
  expect(remove.getAttribute('aria-label')).toBe('Remove slot a')
  remove.click()
  await until(() => panels('workspace').length === 1)
  expect(Object.keys(written('workspace').slots)).toEqual(['b'])
  await until(() => document.activeElement?.classList.contains('dock-area') ?? false)   // focus kept in the dock
  expect(running(h, 'input2')).toBe(true)
})

test('a missing slot is never deployed or started by the dock', async () => {
  const h = await host(), names = Object.keys(h.data().pods)
  const { go, panels } = mount(h, { workspace: page('Main', { a: pod('nowhere') }) })
  go('workspace')
  await until(() => panels('workspace')[0]?.textContent?.includes('not found') ?? false)
  await tick()
  expect(Object.keys(h.data().pods)).toEqual(names)
})

const select: Slot = { kind: 'select', select: { implements: Coord.parse('interface', 'nano.ui.Input') } }

test('a select slot matching pods in two runtimes shows the first (by runtime, then pod) and says how many matched; a page holds pods of runtimes A and B (Review Focus 3)', async () => {
  const h = await host()
  await place(h, 'b', ['inb'])
  await place(h, 'a', ['ina'])
  const { go, panels } = mount(h, { workspace: page('Main', { any: select, fromA: pod('ina', 'a'), fromB: pod('inb', 'b') }) })
  go('workspace')
  await until(() => panels('workspace').length === 3 && running(h, 'ina', 'a') && running(h, 'inb', 'b'))
  const views = panels('workspace').map(p => (p.firstElementChild as { target?: { runtime: string; pod: string } } | null)?.target)
  expect(views.map(t => t && `${t.runtime}/${t.pod}`).sort()).toEqual(['a/ina', 'a/ina', 'b/inb'])
  expect(panels('workspace').filter(p => p.querySelector('[role="status"]')?.textContent === '2 matched').length).toBe(1)
})

test('a select slot stays a select when the dock rewrites the slots (a dock:layout)', async () => {
  const h = await host()
  await place(h, 'a', ['ina'])
  const { go, dock, panels, written } = mount(h, { workspace: page('Main', { any: select, notes: { kind: 'tool', tool: 'notes' } }) })
  go('workspace')
  await until(() => panels('workspace').length === 2)
  dock('workspace').setTemplate('two-cols')   // a dock:layout
  dock('workspace').setTemplate('dock')
  expect(written('workspace').slots).toEqual({ any: { kind: 'select', select: { implements: 'nano.ui.Input' } }, notes: { kind: 'tool', tool: 'notes' } })
})
