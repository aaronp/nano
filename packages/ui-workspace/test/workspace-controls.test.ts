// <nano-workspace-controls dock>: drives its dock by id; the element shows View Tabs | Clear and the dock's commands.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { afterEach, expect, test } from 'bun:test'
// lit picks its DOM build when first imported, so these come after the DOM exists
const { defineWorkspaceControls, WorkspaceControlsEl } = await import('../src/components/workspace-controls.ts')

defineWorkspaceControls()
const tick = () => new Promise(r => setTimeout(r, 0))
type El = HTMLElement & { updateComplete: Promise<boolean> }
const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await tick(); await el.updateComplete } }
const q = (el: El, s: string) => el.shadowRoot!.querySelector(s) as HTMLElement
const qa = (el: El, s: string) => [...el.shadowRoot!.querySelectorAll(s)] as HTMLElement[]

const stubDock = () => {
  const calls: unknown[][] = []
  const d = document.createElement('div') as any
  d.id = 'd1'; d.windowStyle = 'tabs'; d.template = 'dock'; d.panels = 2
  d.arrangement = () => ({ root: { type: 'row', content: Array.from({ length: d.panels }, (_, i) => ({ type: 'component', componentState: { widget: `w${i}` } })) } })
  d.setTemplate = (id: string) => { calls.push(['setTemplate', id]); d.template = id; return true }
  for (const m of ['connections', 'saveAs', 'save', 'restore', 'reset']) d[m] = () => calls.push([m])
  d.setWindowStyle = (s: string) => { calls.push(['setWindowStyle', s]); d.windowStyle = s }
  document.body.append(d)
  return calls
}
const mount = async (narrow = false) => {
  ;(globalThis as any).matchMedia = () => ({ matches: narrow, addEventListener() {}, removeEventListener() {} })
  const calls = stubDock()
  const el = new WorkspaceControlsEl() as unknown as El
  el.setAttribute('dock', 'd1')
  document.body.append(el); await settle(el)
  return { el, calls }
}
afterEach(() => { document.body.innerHTML = '' })

// BACKLOG(5): 'the controls drive their dock' tested the nano-runes component (retired/test/workspace-controls.test.ts).

test('the element shows View Tabs | Clear and six labelled icon buttons', async () => {
  const { el } = await mount()
  const view = qa(el, '.view button')
  expect(view.map(b => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Tabs', 'true'], ['Clear', 'false']])
  const icons = qa(el, 'button[aria-label]:not([role])')
  expect(icons.map(b => b.getAttribute('aria-label'))).toEqual(['Connections', 'Desk', 'Save as workspace…', 'Save layout', 'Restore', 'Reset'])
  for (const b of icons) { expect(b.getAttribute('title')).toBe(b.getAttribute('aria-label')); expect(b.querySelector('svg')).not.toBeNull() }
})

test('clicking Clear calls setStyle', async () => {
  const { el, calls } = await mount()
  qa(el, '.view button')[1]!.click(); await settle(el)
  expect(calls).toEqual([['setWindowStyle', 'focus']])
  expect(qa(el, '.view button').map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  qa(el, 'button[aria-label="Reset"]')[0]!.click(); await settle(el)
  expect(calls.at(-1)).toEqual(['reset'])
})

test('Desk opens the Desk page, beside Connections', async () => {
  const { el, calls } = await mount()
  location.hash = '#/workspace'
  q(el, 'button[aria-label="Desk"]').click(); await settle(el)
  expect(location.hash).toBe('#/desk')
  expect(calls).toEqual([])
})

test('takes the app bar colour', () => {
  const text = (WorkspaceControlsEl.styles as any[]).at(-1).cssText
  expect(text).toContain('color: inherit')
  expect(text.split('\n').filter((l: string) => l.includes('--nano-fg') && !l.includes('.panel'))).toEqual([])
})

test('narrow: the buttons fold into a ⋯ menu', async () => {
  const { el, calls } = await mount(true)
  expect(qa(el, '.view button')).toHaveLength(2)
  const more = q(el, 'button[aria-label="More workspace actions"]')
  expect(qa(el, 'button:not([role])')).toHaveLength(2 + 1 + 6)   // the six sit hidden in the panel
  expect(q(el, '.panel').hasAttribute('hidden')).toBe(true)
  more.click(); await settle(el)
  expect(more.getAttribute('aria-expanded')).toBe('true')
  expect(qa(el, '.panel button:not([role])').map(b => b.textContent!.trim())).toEqual(['Connections', 'Desk', 'Save as workspace…', 'Save layout', 'Restore', 'Reset'])
  qa(el, '.panel button:not([role])')[4]!.click(); await settle(el)
  expect(calls).toEqual([['restore']]); expect(more.getAttribute('aria-expanded')).toBe('false')
  more.click(); await settle(el)
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await settle(el)
  expect(more.getAttribute('aria-expanded')).toBe('false')
})

test('layout picker: eight radios, current checked, misfits disabled with a reason, click switches', async () => {
  const { el, calls } = await mount()
  const rs = qa(el, '[role="radiogroup"][aria-label="Layout"] [role="radio"]')
  expect(rs).toHaveLength(8)
  expect(rs.filter(r => r.getAttribute('aria-checked') === 'true').map(r => r.getAttribute('aria-label'))).toEqual(['Free dock'])
  const grid = rs.find(r => r.getAttribute('aria-label') === 'Grid') as HTMLButtonElement
  expect(grid.disabled).toBe(true); expect(grid.title).toContain('4 panels')
  rs.find(r => r.getAttribute('aria-label') === 'Two columns')!.click(); await settle(el)
  expect(calls).toEqual([['setTemplate', 'two-cols']])
  expect(qa(el, '.view')).toHaveLength(0)
  expect(qa(el, '[role="radio"][aria-checked="true"]').map(r => r.getAttribute('aria-label'))).toEqual(['Two columns'])
})

test('narrow: the layout row is the first child of the menu panel', async () => {
  const { el } = await mount(true)
  const row = q(el, '[role="radiogroup"]')
  expect(row.parentElement).toBe(q(el, '.panel')); expect(q(el, '.panel').firstElementChild).toBe(row)
  expect(qa(el, '[role="radiogroup"]')).toHaveLength(1)
})

test('each thumbnail draws one rect per position', async () => {
  const { el } = await mount()
  const { TEMPLATES } = await import('../src/lib/layout-templates.ts')
  for (const t of TEMPLATES.filter(t => t.positions)) expect(q(el, `[aria-label="${t.title}"]`).querySelectorAll('rect').length).toBe(t.positions!)
})
