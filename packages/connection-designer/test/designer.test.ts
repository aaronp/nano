import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Components, Systems, ok } from '@composable/sdk'
import { provideSystem } from '@composable/ui'
import { defineDesigner, type ConnectionDesigner } from '../src'
const links = (s: { snapshot(): { subscriptions: { source: string; listener: string; target?: string }[] } }) => s.snapshot().subscriptions.filter(x => x.target)

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms))
const Address = Type.Object({ city: Type.String(), country: Type.String(), street: Type.String() }, { $id: 'geo.Address' })
const Jurisdiction = Type.Object({ city: Type.String(), country: Type.String() }, { $id: 'geo.Jurisdiction' })
const Crm = Components.declare({ author: 't', id: 'crm' })
const updated = Crm.op('address-updated', 'An address changed', { output: Address })
const crm = Crm.define({ state: () => null })
const M = Components.declare({ author: 't', id: 'map' })
const toJ = M.op('to-jurisdiction', 'Address → Jurisdiction', { input: Address, output: Jurisdiction })
const map = M.define({ state: () => null, handlers: [[toJ, ({ city, country }) => ok({ city, country })]] })
const T = Components.declare({ author: 't', id: 'tax' })
const rate = T.op('rate-for', 'Set the jurisdiction', { input: Jurisdiction })
const seen: unknown[] = []
const tax = T.define({ state: () => null, handlers: [[rate, j => { seen.push(j) }]] })
defineDesigner()

const setup = async () => {
  // setup: a scope with three components, and a designer inside its provider
  const scope = Systems.create(), host = document.createElement('div')
  provideSystem(host, scope); document.body.append(host)
  const c = crm.create(); scope.register('crm', c); scope.register('map', map.create()); scope.register('tax', tax.create())
  host.innerHTML = '<connection-designer></connection-designer>'
  await tick()
  const d = host.querySelector('connection-designer') as ConnectionDesigner
  await d.updateComplete
  return { scope, d, c, root: d.shadowRoot! }
}
const fire = (el: Element, type: string, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, ...init }))

test('the palette lists the scope\'s components and their pieces', async () => {
  const { root } = await setup()
  expect([...root.querySelectorAll('.palette h4')].map(h => h.textContent!.trim().split(/\s+/)[0])).toEqual(['t/crm', 't/map', 't/tax'])
  expect([...root.querySelectorAll('.palette .tile')].map(s => s.getAttribute('aria-label'))).toEqual([
    'address-updated: — → Address', 'to-jurisdiction: Address → Jurisdiction', 'rate-for: Jurisdiction → —',
  ])
})

test('dragging pieces into a row makes a viable workflow; Live wires the scope and it runs', async () => {
  const { scope, d, c, root } = await setup()
  const pieces = [...root.querySelectorAll('.palette .piece')], boardEl = root.querySelector('.board')!
  // call out our method under test: drag crm, map, tax into cells 0,1,2 of row 0
  for (const [i, p] of pieces.entries()) {
    fire(p, 'dragstart'); fire(boardEl, 'drop', { clientX: i * 150 + 20, clientY: 20 }); await d.updateComplete
  }
  // one workflow, every seam fits, status viable
  expect([...root.querySelectorAll('.placed .seam')].map(s => s.className)).toEqual(['seam ok', 'seam ok'])
  expect(root.querySelector('.intent .status')!.textContent).toContain('viable · 2 route(s)')
  expect(links(scope)).toEqual([])
  // switch on: the orchestrator wires it, and an address flows through to tax
  const live = root.querySelector('.live input') as HTMLInputElement
  live.checked = true; live.dispatchEvent(new Event('change'))
  expect(links(scope).map(r => `${r.source}→${r.listener}`)).toEqual(['crm→map', 'map→tax'])
  await c.notify(updated, { city: 'Leeds', country: 'UK', street: '1 Park Row' }); await tick()
  expect(seen).toEqual([{ city: 'Leeds', country: 'UK' }])
})

test('a mismatched join shows ✕; the document JSON loads, and shows its problems by type name', async () => {
  const { d, root } = await setup()
  const ta = root.querySelector('textarea') as HTMLTextAreaElement
  ta.value = JSON.stringify({ intents: [{ kind: 'workflow', id: 'w', steps: [
    { select: { by: 'component', id: { author: 't', id: 'crm' } }, op: 't/crm/address-updated' },
    { select: { by: 'component', id: { author: 't', id: 'tax' } }, op: 't/tax/rate-for' },
  ] }], layout: {} })
  ta.dispatchEvent(new Event('input'))
  // call out our method under test: Load
  ;(root.querySelector('.row button') as HTMLButtonElement).click(); await d.updateComplete
  expect(root.querySelector('.placed .seam')!.className).toBe('seam mismatch')
  expect(root.querySelector('.intent .problem')!.textContent).toBe('step 0 → 1: Address does not fit Jurisdiction')
})
