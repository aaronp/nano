import '../wires/dom.ts'
import { expect, test } from 'bun:test'
import { defineDesk, type Desk } from '../../src/desk'
import { setup } from '../wires/setup'
import { Debounce, MapIface, k, p2 } from '../wires/setup'
import { port } from '@pritzlaff/nano-core'

defineDesk()
const tick = () => new Promise(r => setTimeout(r, 0))
async function mount() {
  const s = await setup()
  const el = document.createElement('c-desk') as Desk
  el.host = s.host
  document.body.append(el)
  const settle = async () => { await tick(); await tick(); await el.updateComplete }
  await settle()
  return { ...s, el, root: el.shadowRoot!, settle }
}
const drag = (target: Element, dx: number, dy: number) => {
  target.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true }))
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 + dx, clientY: 100 + dy }))
  window.dispatchEvent(new MouseEvent('pointerup', { clientX: 100 + dx, clientY: 100 + dy }))
}
const pods = (root: ShadowRoot) => [...root.querySelectorAll('[data-runtime="main"] [data-pod]')].map(e => (e as HTMLElement).dataset.pod)
const x = (root: ShadowRoot, pod: string) => parseInt((root.querySelector<HTMLElement>(`[data-pod="${pod}"]`)!).style.left)

test('renders a runtime box with a column per pod', async () => {
  const { root } = await mount()
  expect(pods(root)).toEqual(['r', 'd', 'l'])
})

test('draws a solid cord per pipe', async () => {
  const { root, s1, s2 } = await mount()
  expect([...root.querySelectorAll('path[data-pipe]')].map(p => p.getAttribute('data-pipe'))).toEqual([s1.id, s2.id])
})

test('rebuilds on apply', async () => {
  const { root, app, host, settle } = await mount()
  const next = structuredClone(host.data())
  next.runtimes.main!.subscriptions.push({ ...p2, to: 'm', target: port(MapIface, MapIface.ops.map) })
  await app.apply(next)
  await settle()
  expect(root.querySelectorAll('path[data-pipe]').length).toBe(3)
  expect(root.querySelector('[data-pod="m"]')).not.toBeNull()
})

test('Align resets a dragged column', async () => {
  const { root, el, settle } = await mount()
  const x0 = x(root, 'r')
  drag(root.querySelector('[data-pod="r"]')!, 100, 0)
  await settle()
  expect(el.layout().pods.main!.r!.x).toBe(x0 + 100)
  root.querySelector<HTMLElement>('[data-align]')!.click()
  await settle()
  expect(x(root, 'r')).toBe(x0)
})

test('Compact narrows columns', async () => {
  const { root, settle } = await mount()
  const w = () => parseInt(root.querySelector<HTMLElement>('[data-pod="d"]')!.style.width)
  const w0 = w()
  root.querySelector<HTMLElement>('[data-compact]')!.click()
  await settle()
  expect(w()).toBeLessThan(w0)
})

test('snap toggle keeps positions', async () => {
  const { root, el, settle } = await mount()
  root.querySelector<HTMLElement>('[data-snap-toggle]')!.click()
  await settle()
  drag(root.querySelector('[data-pod="r"]')!, 13, 7)
  await settle()
  const p = { ...el.layout().pods.main!.r! }
  expect(p.x % 20).not.toBe(0)
  root.querySelector<HTMLElement>('[data-snap-toggle]')!.click()
  await settle()
  expect(el.layout().pods.main!.r).toEqual({ x: Math.round(p.x / 20) * 20, y: Math.round(p.y / 20) * 20 })
})

test('an event out jack is marked, an action in jack is not', async () => {
  const { root } = await mount()
  const j = (key: string) => root.querySelector(`[data-jack="main ${key}"]`)!
  expect(j(k('d', Debounce, 'flushed', 'out')).hasAttribute('data-event')).toBe(true)
  expect(j(k('d', Debounce, 'push', 'in')).hasAttribute('data-event')).toBe(false)
})

test('a hidden pod keeps its saved position across view changes; a removed pod loses it', async () => {
  const { root, el, app, host, settle } = await mount()
  const show = async (s: string) => { root.querySelector<HTMLElement>(`[data-show="${s}"]`)!.click(); await settle() }
  await show('all')
  drag(root.querySelector('[data-pod="m"]')!, 0, 200)
  await settle()
  const saved = { ...el.layout().pods.main!.m! }
  await show('connected')
  expect(root.querySelector('[data-pod="m"]')).toBeNull()
  expect(el.layout().pods.main!.m).toEqual(saved)
  await show('all')
  expect(el.layout().pods.main!.m).toEqual(saved)
  const next = structuredClone(host.data())
  delete next.pods.m; next.runtimes.main!.pods = next.runtimes.main!.pods.filter(p => p !== 'm')
  await app.apply(next); await settle()
  expect(el.layout().pods.main!.m).toBeUndefined()
})
