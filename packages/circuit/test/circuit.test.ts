import { afterEach, expect, test } from 'bun:test'
import { Ops } from '@pritzlaff/nano-core'
import { catalog, Debounce, Log, Range } from '@composable/bundle'
import { ApplicationOps as P, createApplication } from '@pritzlaff/nano-app'
import { defineCircuit, type Circuit } from '../src'

defineCircuit()
afterEach(() => { document.body.innerHTML = '' })
const tick = () => new Promise(r => setTimeout(r, 0))

// a host with r → d → l, a page /a showing r, d (tabbed behind r) and l, and a page /b showing l
async function mount() {
  const { host } = createApplication({ catalogs: [catalog], placementsOf: (layout: any) => layout ?? [] })
  const call = (op: any, arg?: unknown) => host.call({ registry: 'host', instance: 'test' }, 'application', Ops.key(op), arg) as Promise<any>
  for (const [kind, name] of [['range', 'r'], ['debounce', 'd'], ['log', 'l'], ['map', 'm']]) await call(P.createComponent, { kind, name, system: 'host' })
  const rd = (await call(P.connect, { system: 'host', source: 'r', op: Ops.key(Range.ops.value), listener: 'd', target: Ops.key(Debounce.ops.enqueue) })).value
  await call(P.connect, { system: 'host', source: 'd', op: Ops.key(Debounce.ops.flushed), listener: 'l', target: Ops.key(Log.ops.info) })
  const tab = (instance: string, active: boolean) => ({ panel: instance, instance, box: { x: 0.05, y: 0.2, w: 0.4, h: 0.6 }, tab: { group: 'g', active } })
  await call(P.setScreen, { id: '/a', title: 'Alpha', system: 'host', layout: [tab('r', true), tab('d', false), { panel: 'l', instance: 'l', box: { x: 0.55, y: 0.2, w: 0.4, h: 0.6 } }] })
  await call(P.setScreen, { id: '/b', title: 'Beta', system: 'host', layout: [{ panel: 'l', instance: 'l' }] })
  const el = document.createElement('c-circuit') as Circuit
  el.runtime = host
  document.body.append(el)
  await tick(); await el.updateComplete
  const settle = async () => { await tick(); await tick(); await el.updateComplete }
  return { host, call, el, root: el.shadowRoot!, settle, rd }
}

test('renders a layer per screen and the focus layer opaque', async () => {
  const { root, el } = await mount()
  const layers = [...root.querySelectorAll<HTMLElement>('section.layer')]
  expect(layers.length).toBe(2)
  expect(el.page).toBe('/a')
  expect(layers[0]!.style.opacity).toBe('1')
  expect(layers[1]!.style.opacity).toBe('0.65')
})

test('a page pill focuses that page', async () => {
  const { root, el, settle } = await mount()
  root.querySelector<HTMLElement>('.pill[data-screen="/b"]')!.click()
  await settle()
  expect(el.page).toBe('/b')
  expect(root.querySelector<HTMLElement>('[data-screen="/b"] .layer')!.style.opacity).toBe('1')
  expect(root.querySelector('.pill[data-screen="/b"]')!.getAttribute('aria-pressed')).toBe('true')
  expect(root.querySelector('.pill[data-whole]')).not.toBeNull()
})

test('ArrowRight moves the focus to the next page', async () => {
  const { el, settle } = await mount()
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await settle()
  expect(el.page).toBe('/b')
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  expect(el.page).toBe('/a')
})

test('wheel zoom is clamped to 0.3–2.5', async () => {
  const { el, root } = await mount()
  const stage = root.querySelector('.stage')!
  for (let i = 0; i < 40; i++) stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true, cancelable: true }))
  expect(el.s.zoom).toBe(2.5)
  for (let i = 0; i < 80; i++) stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 500, bubbles: true, cancelable: true }))
  expect(el.s.zoom).toBe(0.3)
})

test('a pad has an accessible label', async () => {
  const { root } = await mount()
  expect(root.querySelector('button.pad[aria-label="r.value, Number, out"]')).not.toBeNull()
  expect(root.querySelector('button.pad[aria-label="l.info, Any, in"]')).not.toBeNull()
})

test('a change in the Application re-renders', async () => {
  const { call, root, settle } = await mount()
  expect(root.querySelectorAll('.pill[data-screen]').length).toBe(2)
  await call(P.setScreen, { id: '/c', title: 'Gamma', system: 'host', layout: [] })
  await settle()
  expect(root.querySelector('.pill[data-screen="/c"]')!.textContent).toContain('Gamma')
})

test('an inactive tab is a label on its group box: its cable ends at the label', async () => {
  const { root } = await mount()
  const label = root.querySelector<HTMLElement>('[data-screen="/a"] .tab[data-tab="d"]')!
  expect(label.getAttribute('aria-pressed')).toBe('false')
  expect(root.querySelector('[data-screen="/a"] .fp[data-instance="d"]')).toBeNull()
  const cable = root.querySelector<SVGPathElement>('path[data-cable]')!   // r → d, drawn in /a
  expect(Number(cable.dataset.x2)).toBe(Number(label.dataset.cx))
  expect(Number(cable.dataset.y2)).toBe(Number(label.dataset.cy))
})
