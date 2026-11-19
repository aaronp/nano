// <c-wires>: the connections view; see wires-mount.ts for the stand-in dock.
import './dom.ts'
import { afterEach, expect, test } from 'bun:test'
import { defineWires } from '../../src/wires'
import { onDown, onMove, onUp, toggleEdit } from '../../src/wires/pointer'
import { connectPipe, disconnectPipe } from '../../src/wires/edit'
import { Debounce, Input, k, Log, MapIface, model, p2, setup } from './setup.ts'
import { mount } from './wires-mount.ts'

defineWires()
afterEach(() => { document.body.innerHTML = '' })

test('dragging from an out jack to a fitting in jack connects them: a pipe is applied', async () => {
  const { el, pipes, flip, settle, at } = await mount()
  await flip()
  toggleEdit(el)
  onDown(el, at(k('r', Input, 'submit', 'out')))
  onMove(el, at(k('m', MapIface, 'map', 'in')))
  expect(el.s.cord!.err).toBeNull()
  await onUp(el, at(k('m', MapIface, 'map', 'in')))
  await settle()
  expect(pipes().some(s => s.from === 'r' && s.to === 'm' && s.kind === 'pipe' && s.target === 'nano.ui.Map/map')).toBe(true)
  expect(el.model.wires.length).toBe(3)
  expect(el.shadowRoot!.querySelector('[role="status"]')!.textContent).toBe('Patched r.submit → m.map')
})

test('a plugged input dropped in space is disconnected', async () => {
  const { el, pipes, s1, flip, settle, at } = await mount()
  await flip()
  toggleEdit(el)
  onDown(el, at(k('d', Debounce, 'push', 'in')))
  expect(el.s.cord!.picked).toBe(s1.id)
  await onUp(el, { clientX: 600, clientY: 400 })
  await settle()
  expect(pipes().some(s => s.from === 'r' && s.to === 'd')).toBe(false)
})

test('refusals are shown: a misfit cord, and one the app refuses', async () => {
  const { el, root, flip, settle, at } = await mount()
  await flip()
  toggleEdit(el)
  onDown(el, at(k('l', Log, 'entries', 'out')))
  onMove(el, at(k('r', Input, 'submit', 'out')))
  await settle()
  expect(root.querySelector('[role="status"]')!.textContent).toBe('Both jacks emit events — patch an output into an input')
  await onUp(el, at(k('r', Input, 'submit', 'out')))
  expect(await el.create('nope/nope')).toBeNull()
  await settle()
  expect(root.querySelector('[role="status"]')!.textContent).toContain('nope')
})
test('a cord between pods in different runtimes is refused', async () => {
  const { el, host, root, flip, settle, at } = await mount()
  const d = host.data()
  d.runtimes['main']!.pods = d.runtimes['main']!.pods.filter(p => p !== 'm')
  d.runtimes['lab'] = { pods: ['m'], subscriptions: [] }
  expect((await host.apply(d)).ok).toBe(true)
  await flip()
  toggleEdit(el)
  onDown(el, at(k('r', Input, 'submit', 'out')))
  onMove(el, at(k('m', MapIface, 'map', 'in')))
  await onUp(el, at(k('m', MapIface, 'map', 'in')))
  await settle()
  expect(root.querySelector('[role="status"]')!.textContent).toBe('r and m are not in one runtime')
})
test('connectPipe adds the pipe through core', async () => {
  const { host, app } = await setup()
  const r = await connectPipe(host, model(app.deployment()), k('l', Log, 'log', 'out'), k('m', MapIface, 'map', 'in'))
  expect(r).toEqual({ value: { id: expect.any(String) } })
  expect(app.deployment().runtimes.main!.subscriptions.some(s => s.kind === 'pipe' && s.from === 'l' && s.to === 'm')).toBe(true)
})
test('disconnectPipe removes it', async () => {
  const { host, app, s1 } = await setup()
  expect(await disconnectPipe(host, s1.id)).toEqual({})
  expect(app.deployment().runtimes.main!.subscriptions).toEqual([p2])
})
test('a refusal is returned, not thrown', async () => {
  const { host, app } = await setup()
  const before = app.deployment()
  expect(await disconnectPipe(host, 'main|x|y|a|b')).toEqual({ error: expect.any(String) })
  expect(app.deployment()).toEqual(before)
})
