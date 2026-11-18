import '../circuit/dom.ts'
import { expect, test } from 'bun:test'
import { defineDesk, type Desk } from '../../src/desk'
import { checkConnect } from '../../src/wires/model'
import { setup, Debounce, Input, Log, MapIface, k } from '../wires/setup'

defineDesk()
const tick = () => new Promise(r => setTimeout(r, 0))
async function mount(edit = true) {
  const s = await setup()
  const el = document.createElement('c-desk') as Desk
  el.host = s.host
  el.view = { show: 'all', pills: { runtimes: [], pods: [] } }
  document.body.append(el)
  const root = el.shadowRoot!
  const settle = async () => { await tick(); await tick(); await el.updateComplete }
  await settle()
  if (edit) { root.querySelector<HTMLElement>('[data-edit]')!.click(); await settle() }
  const jack = (key: string) => root.querySelector<HTMLElement>(`[data-jack="main ${key}"]`)!
  const cord = (id: string) => root.querySelector<SVGElement>(`path[data-pipe="${id}"]`)!
  const subs = () => JSON.stringify(s.app.deployment().runtimes.main!.subscriptions)
  const key = (name: string, from: EventTarget = root.querySelector('.stage')!) => from.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, composed: true, cancelable: true }))
  return { ...s, el, root, settle, jack, cord, subs, key }
}
const logOut = k('l', Log, 'log', 'out'), mapIn = k('m', MapIface, 'map', 'in')

test('edit off: clicks and Delete change nothing', async () => {
  const t = await mount(false)
  const before = t.subs()
  t.jack(logOut).click(); t.jack(mapIn).click(); t.cord(t.s1.id).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); t.key('Delete')
  await t.settle()
  expect(t.subs()).toBe(before)
  expect(t.root.querySelector('[data-fits]')).toBeNull()
})

test('connect two fitting jacks', async () => {
  const t = await mount()
  const n = t.app.deployment().runtimes.main!.subscriptions.length
  t.jack(logOut).click(); await t.settle()
  t.jack(mapIn).click(); await t.settle()
  expect(t.app.deployment().runtimes.main!.subscriptions.length).toBe(n + 1)
})

test('fits marks', async () => {
  const t = await mount()
  t.jack(logOut).click(); await t.settle()
  expect(t.jack(mapIn).hasAttribute('data-fits')).toBe(true)
  expect(t.root.querySelectorAll('[data-pod="r"] .out[data-fits]').length).toBe(0)
})

test('refuses same-pod, wrong direction and duplicate', async () => {
  const t = await mount()
  const m = t.host.data && (await import('../../src/desk/model')).deskModel(t.host.data(), t.host.registry, [], { show: 'all', pills: { runtimes: [], pods: [] } }, 'ui').wires
  const cases = [
    [logOut, k('l', Log, 'log', 'in')],
    [logOut, k('d', Debounce, 'flushed', 'out')],
    [k('d', Debounce, 'flushed', 'out'), k('l', Log, 'log', 'in')],
  ] as const
  for (const [a, b] of cases) {
    const before = t.subs(), want = checkConnect(m, a, b)
    t.jack(a).click(); await t.settle(); t.jack(b).click(); await t.settle()
    expect('error' in want && t.root.querySelector('[data-toast]')?.textContent).toBe((want as { error: string }).error)
    expect(t.subs()).toBe(before)
    t.key('Escape'); await t.settle()
  }
})

test('remove a selected pipe', async () => {
  const t = await mount()
  t.cord(t.s1.id).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); await t.settle()
  t.key('Delete'); await t.settle()
  const ids = t.app.deployment().runtimes.main!.subscriptions.map(s => s.from)
  expect(ids).toEqual(['d'])
})

test('Esc clears the selection', async () => {
  const t = await mount()
  t.jack(logOut).click(); await t.settle()
  t.key('Escape'); await t.settle()
  expect(t.el.sel).toBeNull()
  expect(t.root.querySelector('[data-fits]')).toBeNull()
})

test('Backspace typed in an input elsewhere does not unplug', async () => {
  const t = await mount()
  t.cord(t.s1.id).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true })); await t.settle()
  const before = t.subs(), input = document.createElement('input')
  document.body.append(input)
  t.key('Backspace', input); await t.settle()
  expect(t.subs()).toBe(before)
})

test('reactive properties are not shadowed by class fields, and editing re-renders', async () => {
  const t = await mount(false)
  for (const p of ['host', 'application', 'editing', 'sel']) expect(Object.hasOwn(t.el, p)).toBe(false)
  t.el.editing = true; await t.settle()
  expect(t.root.querySelector('[data-edit][aria-pressed="true"]')).not.toBeNull()
})

// l and m are in main and in side
async function twoRuntimes() {
  const t = await mount()
  const next = structuredClone(t.host.data())
  next.runtimes.side = { pods: ['l', 'm'], subscriptions: [] }
  await t.app.apply(next); await t.settle()
  const at = (rt: string, key: string) => t.root.querySelector<HTMLElement>(`[data-jack="${rt} ${key}"]`)!
  return { ...t, at }
}

test('a patch lands in the runtime the jacks were clicked in', async () => {
  const t = await twoRuntimes()
  t.at('side', logOut).click(); await t.settle()
  t.at('side', mapIn).click(); await t.settle()
  expect(t.app.deployment().runtimes.side!.subscriptions.map(s => s.from + '>' + s.to)).toEqual(['l>m'])
  expect(t.app.deployment().runtimes.main!.subscriptions.length).toBe(2)
})

test('jacks in two runtimes are refused, and fits are marked only in the selected jack\'s runtime', async () => {
  const t = await twoRuntimes()
  t.at('side', logOut).click(); await t.settle()
  expect(t.at('side', mapIn).hasAttribute('data-fits')).toBe(true)
  expect(t.at('main', mapIn).hasAttribute('data-fits')).toBe(false)
  const before = JSON.stringify(t.app.deployment().runtimes)
  t.at('main', mapIn).click(); await t.settle()
  expect(t.root.querySelector('[data-toast]')).not.toBeNull()
  expect(JSON.stringify(t.app.deployment().runtimes)).toBe(before)
})
