import { beforeEach, expect, test } from 'bun:test'
import { definePuzzlePort, type PuzzlePort } from '../src'

definePuzzlePort()

beforeEach(() => { localStorage.clear(); document.body.innerHTML = '' })

const mount = async () => {
  const el = document.createElement('puzzle-port') as PuzzlePort
  document.body.append(el)
  await el.updateComplete
  const root = el.shadowRoot!
  const settle = () => el.updateComplete
  const buttons = () => [...root.querySelectorAll('button')]
  const button = (text: string) => buttons().find(b => b.textContent!.trim() === text) ?? null
  const click = async (text: string) => { const b = button(text); if (!b) throw new Error('no button ' + text); b.click(); await settle() }
  const type = async (label: string, value: string) => {
    const i = root.querySelector(`[aria-label="${label}"]`) as HTMLInputElement
    i.value = value; i.dispatchEvent(new Event('input', { bubbles: true })); await settle()
  }
  const text = () => root.textContent!.replace(/\s+/g, ' ')
  return { el, root, settle, button, buttons, click, type, text }
}

// an element "Pay" with a source action "charge" that outputs a string
const withAction = async () => {
  const t = await mount()
  await t.click('+ Element')
  await t.type('New element name', 'Pay')
  await t.click('Add')
  await t.type('Action name', 'charge')
  const stringChips = t.buttons().filter(b => b.hasAttribute('aria-pressed') && b.textContent!.trim() === 'string')
  stringChips[1]!.click(); await t.settle()   // the output picker
  await t.click('Add action')
  return t
}

test('renders the 1440×900 artboard with the panel, canvas and fonts', async () => {
  const { root, text } = await mount()
  const art = root.firstElementChild as HTMLElement
  expect(art.getAttribute('style')).toContain('width: 1440px; height: 900px; background: #0D0F13')
  expect(root.querySelector('[data-canvas="puzzle"]')).not.toBeNull()
  expect(text()).toContain('Puzzle editor')
  expect(text()).toContain('The board is empty.')
  expect(document.head.querySelectorAll('link[data-puzzle-port-fonts]').length).toBe(1)
})

test('switches between the Elements and Types tabs', async () => {
  const { el, root, click, text } = await mount()
  const tab = (n: number) => root.querySelectorAll('[role="tab"]')[n]!
  expect(tab(0).getAttribute('aria-selected')).toBe('true')
  await click('Types')
  expect(el.s.tab).toBe('types')
  expect(tab(1).getAttribute('aria-selected')).toBe('true')
  expect(text()).toContain('BUILT-IN')
  await click('Elements')
  expect(el.s.tab).toBe('elements')
  expect(text()).toContain('+ Element')
})

test('adds an element and an action', async () => {
  const { el, text } = await withAction()
  expect(el.s.model.elements.map(e => e.name)).toEqual(['Pay'])
  expect(el.s.model.actions).toMatchObject([{ name: 'charge', input: null, output: { typeId: 'string', array: false } }])
  expect(text()).toContain('PAY')
  expect(text()).toContain('→ string')
  expect(el.s.notice).toBe('Added charge. Drag it onto the board.')
  expect(JSON.parse(localStorage.getItem('puzzle-port-v1')!).actions).toHaveLength(1)
})

test('creates a record type and adds a field', async () => {
  const { el, click, type } = await mount()
  await click('Types')
  await click('+ New record type')
  await type('New record type name', 'Address')
  await click('Create')
  const t = () => el.s.model.types.find(x => x.name === 'Address')!
  expect(t().kind).toBe('record')
  expect(t().fields).toHaveLength(1)
  expect(el.s.editorOpen).toBe(true)
  await click('Done')
  await click('+ Field')
  expect(t().fields!.map(f => f.name)).toEqual(['field1', 'field2'])
})

test('places a piece on the board by dragging, and takes it off', async () => {
  const { el, root, settle, click, text } = await withAction()
  const canvas = root.querySelector('[data-canvas="puzzle"]')!
  canvas.getBoundingClientRect = () => ({ left: 320, top: 0, width: 1120, height: 900, right: 1440, bottom: 900, x: 320, y: 0, toJSON() {} }) as DOMRect
  const art = root.firstElementChild!
  const row = root.querySelector('div[style*="cursor: grab"]')!
  row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 })); await settle()
  art.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 460, clientY: 170 })); await settle()
  expect(el.s.drag?.moved).toBe(true)
  art.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 460, clientY: 170 })); await settle()
  const id = el.s.model.actions[0]!.id
  expect(el.s.model.placements[id]).toEqual({ c: 0, r: 0 })
  expect(text()).toContain('1 placed · 0 connections · 0 problems')
  await click('Output: right')
  expect(el.s.model.actions[0]!.outputSide).toBe('B')
  await click('Take off')
  expect(el.s.model.placements[id]).toBeUndefined()
  expect(text()).toContain('0 placed')
})

test('opens the shape editor and picks a preset', async () => {
  const { el, root, click, settle } = await mount()
  await click('Types')
  await click('stringbuilt-in')   // the type row: name and detail spans
  expect(el.s.editorOpen).toBe(true)
  expect(el.s.model.types.find(t => t.id === 'string')!.shape.preset).toBe('jigsaw');
  (root.querySelector('button[aria-label="Dome"]') as HTMLButtonElement).click(); await settle()
  const string = el.s.model.types.find(t => t.id === 'string')!
  expect(string.shape.preset).toBe('dome')
  expect(string.shapeSource).toBe('custom')
  expect(root.querySelector('button[aria-label="Dome"]')!.getAttribute('style')).toContain('border: 1px solid #9B8CFF')
})

test('Show model toggles the model view', async () => {
  const { click, text, button } = await withAction()
  expect(text()).not.toContain('MODEL')
  await click('Show model')
  expect(text()).toContain('MODEL')
  expect(text()).toContain('"name": "charge"')
  expect(button('Hide model')).not.toBeNull()
  await click('Hide model')
  expect(text()).not.toContain('MODEL')
})

test('Clear all resets the model', async () => {
  const { el, click, text } = await withAction()
  await click('Clear all')
  expect(el.s.model.elements).toEqual([])
  expect(el.s.model.actions).toEqual([])
  expect(el.s.model.types.map(t => t.id)).toEqual(['string', 'number', 'boolean'])
  expect(el.s.notice).toBe('Cleared.')
  expect(text()).toContain('An element is a namespace for actions.')
})

test('the Code view applies edited TypeScript', async () => {
  const { el, root, click, type, text } = await mount()
  await click('Types')
  await click('Code')
  expect((root.querySelector('textarea') as HTMLTextAreaElement).value).toContain('// Built-in: string, number, boolean')
  await type('TypeScript types', 'interface Point { x: number; y: number }\ntype Email = string;')
  expect(text()).toContain('adds Point, Email')
  await click('Apply')
  expect(el.s.model.types.map(t => t.name)).toEqual(['string', 'number', 'boolean', 'Point', 'Email'])
  expect(el.s.model.types.find(t => t.name === 'Email')!.kind).toBe('alias')
})
