import { expect, test } from 'bun:test'
import { unwrap } from '@composable/sdk'
import { OrchestratorOps, Orchestrators } from '@composable/connections'
import { ConnectionEditorOps } from '../src'
import { iconFor, tilePath } from '../src/views/tiles'
import { PRESETS } from '../src/model'
import { click, clickLive, dragRow, hosted, select, type } from './dom-helpers'
import { flush } from './fixtures'

const made = (s: { snapshot(): { subscriptions: { listener: string; target?: string }[] } }) =>
  s.snapshot().subscriptions.filter(x => x.listener !== 'orchestrator' && x.target)

test('the palette lists the components and their pieces', async () => {
  const { el } = await hosted('connection-editor')
  const root = el.shadowRoot!
  expect([...root.querySelectorAll('.palette h4')].map(h => h.textContent!.trim().split(/\s+/)[0])).toEqual(['t/crm', 't/map', 't/tax'])
  expect([...root.querySelectorAll('.palette .tile')].map(s => s.getAttribute('aria-label'))).toEqual([
    'address-updated: — → Address', 'to-jurisdiction: Address → Jurisdiction', 'rate-for: Jurisdiction → —',
  ])
})

test('dragging pieces into a row makes a viable workflow; a bad join shows a mismatch', async () => {
  const { el, model } = await hosted('connection-editor')
  const root = el.shadowRoot!
  await dragRow(el, ['t/crm', 't/map', 't/tax'])
  expect([...root.querySelectorAll('.placed .seam')].map(s => s.className)).toEqual(['seam ok', 'seam ok'])
  expect(root.querySelector('.intent .status')!.textContent).toContain('viable · 2 route(s)')
  expect(model.state.connections.intents).toHaveLength(1)
})

test('a mismatched join shows a cross, and its problem by type name', async () => {
  const { el } = await hosted('connection-editor')
  await dragRow(el, ['t/crm', 't/tax'])
  expect(el.shadowRoot!.querySelector('.placed .seam')!.className).toBe('seam mismatch')
  expect(el.shadowRoot!.querySelector('.intent .problem')!.textContent).toBe('step 0 → 1: Address does not fit Jurisdiction')
})

test('a failed edit shows as text, not a throw', async () => {
  const { el } = await hosted('connection-editor')
  await dragRow(el, ['t/crm', 't/crm'])          // second drop lands on cell (1,0): fine
  await dragRow(el, ['t/crm'])                   // cell (0,0) is occupied: place rejected
  expect(el.shadowRoot!.querySelector('.error')!.textContent).toContain('place rejected')
})

test('switching Live off removes the links a linked orchestrator made', async () => {
  const { s, el } = await hosted('connection-editor')
  Orchestrators.create(s, [])
  const id = el.getAttribute('name')!
  unwrap(s.subscribe({ source: id, op: ConnectionEditorOps.intentsUpdated.name, listener: 'orchestrator', target: OrchestratorOps.setIntents.name }))
  await dragRow(el, ['t/crm', 't/map', 't/tax'])
  await clickLive(el, true); await flush()
  expect(made(s)).toHaveLength(2)
  await clickLive(el, false); await flush()
  expect(made(s)).toHaveLength(0)
})

test('the component list adds a draft with an op and its types, marked draft', async () => {
  const { el, model } = await hosted('component-list')
  await click(el, '.add-element'); await type(el, '.new-element input', 'people'); await click(el, '.new-element button')
  await click(el, '[data-component="me/people"] .add-op'); await type(el, '.new-op input', 'create'); await click(el, '.new-op button')
  await select(el, '[data-op="create"] .input', 'string')
  expect(model.state.drafts[0]).toMatchObject({ ops: [{ name: 'create', input: { type: 'string', array: false } }] })
  expect(el.shadowRoot!.querySelector('[data-component="me/people"]')!.classList.contains('draft')).toBe(true)
  await click(el, '[data-op="create"] .input-array')
  expect(model.state.drafts[0].ops[0].input).toEqual({ type: 'string', array: true })
})

test('the component list shows a duplicate element as an error', async () => {
  const { el } = await hosted('component-list')
  for (let i = 0; i < 2; i++) { await click(el, '.add-element'); await type(el, '.new-element input', 'people'); await click(el, '.new-element button') }
  expect(el.shadowRoot!.querySelector('.error')!.textContent).toContain('already exists')
})

test('tilePath and iconFor draw closed paths', () => {
  const d = tilePath({ T: 'flat', B: 'flat', R: 'knob', L: 'hole' }, { R: PRESETS.jigsaw, L: PRESETS.jigsaw })
  expect(d).toStartWith('M 40 40') ; expect(d).toEndWith('Z'); expect(d).toContain('C ')
  expect(iconFor(PRESETS.dome)).toStartWith('M 3 1')
})
