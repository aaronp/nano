import { expect, test } from 'bun:test'
import { Components, unwrap } from '@composable/sdk'
import { OrchestratorOps, Orchestrators } from '@composable/connections'
import { ConnectionEditorOps, TypeEditorOps } from '../src'
import { iconFor, tilePath } from '../src/views/tiles'
import { defineEditor } from '../src/views'
import { PRESETS, presetShape, type EditorType } from '../src/model'
import { click, clickLive, dragRow, hosted, select, type } from './dom-helpers'
import { flush, updated } from './fixtures'

const made = (s: { snapshot(): { subscriptions: { source: string; listener: string; target?: string }[] } }) =>
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
  expect(made(s)).toEqual([])
  await clickLive(el, true); await flush()
  expect(made(s).map(x => `${(x as any).source}→${x.listener}`)).toEqual(['crm→map', 'map→tax'])
  await (s.component('crm') as any).notify(updated, { city: 'Leeds', country: 'UK', street: '1 Park Row' }); await flush()
  expect((s.component('tax') as any).state).toEqual([{ city: 'leeds', country: 'UK' }])
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
  await select(el, '[data-op="create"] .input', '')
  expect(model.state.drafts[0].ops[0].input).toBeUndefined()
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

test('the type editor: add a record, code view errors, shape editor presets', async () => {
  const { el, model } = await hosted('type-editor')
  await click(el, '.new-record'); await type(el, '.new-record-form input', 'Address'); await click(el, '.new-record-form button')
  expect([...el.shadowRoot!.querySelectorAll('.type-row .name')].map(n => n.textContent)).toContain('Address')
  await click(el, '.tab-code'); await type(el, 'textarea.code', 'type A = {\n  x: Strin;\n}'); await click(el, '.apply')
  expect(el.shadowRoot!.querySelector('.problem')!.textContent).toBe('Line 2: unknown type Strin')
  expect(model.state.types.some((t: EditorType) => t.kind === 'record' && t.name === 'A')).toBe(false)
  await click(el, '.tab-list'); await click(el, '[data-type="string"] .edit-shape'); await click(el, '.preset[data-preset="dome"]')
  expect(model.state.types.find((t: EditorType) => t.id === 'string')).toMatchObject({ look: { shape: presetShape('dome') } })
  await click(el, '.swatch[data-colour="#FF8FC0"]'); await click(el, '.pattern[data-pattern="dots"]')
  const segs = () => model.state.types.find((t: EditorType) => t.id === 'string').look.shape.segs.length
  const points = segs()
  await click(el, '.remove-point')   // nothing selected: refused, with a message
  expect(segs()).toBe(points); expect(el.shadowRoot!.querySelector('.shape-editor')!.textContent).toContain('Select a middle point first')
  await click(el, '.add-point'); expect(segs()).toBe(points + 1)   // the new point is selected
  await click(el, '.remove-point'); expect(segs()).toBe(points)
  expect(model.state.types.find((t: EditorType) => t.id === 'string')).toMatchObject({ look: { colour: '#FF8FC0', pattern: 'dots' } })
  expect(el.shadowRoot!.querySelector('.used-by')!.textContent).toBe('Not used yet.')
  await click(el, '.done'); expect(el.shadowRoot!.querySelector('.shape-editor')).toBeNull()
})

test('<puzzle-editor>: both tabs and the board in one System; Show model shows the document', async () => {
  const { el } = await hosted('puzzle-editor')
  expect(el.shadowRoot!.querySelector('component-list, [data-part="component-list"]')).not.toBeNull()
  await click(el, '.tab-types'); expect(el.shadowRoot!.querySelector('type-editor, [data-part="type-editor"]')).not.toBeNull()
  expect(el.shadowRoot!.querySelector('.status-line')!.textContent).toBe('0 placed · 0 connections · 0 problems')
  await click(el, '.show-model'); expect(JSON.parse(el.shadowRoot!.querySelector('.model pre')!.textContent!)).toMatchObject({ types: expect.any(Array) })
  const added = () => el.component.children.document.state.doc.types.length
  await el.component.children.types.systems[0].call('types', TypeEditorOps.addRecord, { id: 'a', name: 'Address' }); await flush()
  const n = added(), confirm = window.confirm
  try {
    window.confirm = () => false; await click(el, '.clear-all'); expect(added()).toBe(n)   // declined: nothing cleared
    window.confirm = () => true; await click(el, '.clear-all'); expect(added()).toBe(n - 1)
  } finally { window.confirm = confirm }
  expect(el.shadowRoot!.querySelector('.problem')).toBeNull()
})

test('a fan-out rule from a component that has gone shows an error, not a throw', async () => {
  const { s, el } = await hosted('connection-editor')
  await select(el, '.rule select', 't/crm')
  const page = unwrap(s.register('other', Components.party()))
  await page.call('connection-editor', ConnectionEditorOps.setInstances, s.snapshot().instances.filter(i => i.id === 'map')); await flush()
  await click(el, '.add-rule')
  expect(el.shadowRoot!.querySelector('.error')!.textContent).toContain('t/crm is no longer on the palette')
})

test('a successful code apply shows the printed source; two prefixes can be defined', async () => {
  const { el, model } = await hosted('type-editor')
  await click(el, '.tab-code'); await type(el, 'textarea.code', 'type   B = string; // brand'); await click(el, '.apply')
  expect(model.state.types.some((t: EditorType) => t.kind === 'brand' && t.name === 'B')).toBe(true)
  expect((el.shadowRoot!.querySelector('textarea.code') as HTMLTextAreaElement).value).toContain('type B = string; // brand')
  defineEditor('alt-')
  expect(customElements.get('alt-puzzle-editor')).toBeDefined()
})
