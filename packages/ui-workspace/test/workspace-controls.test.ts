// WorkspaceControls: the component drives its dock by id; the element shows View Tabs | Clear and the dock's commands.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { afterEach, expect, test } from 'bun:test'
// lit picks its DOM build when first imported, so these come after the DOM exists
const { Components, Ops, Registries, Runtimes } = await import('@pritzlaff/nano-core')
const { provide } = await import('@pritzlaff/nano-elements')
const { controlsId, defineWorkspaceControls, WorkspaceControls, WorkspaceControlsEl } = await import('../src/components/workspace-controls.ts')

defineWorkspaceControls()
const tick = () => new Promise(r => setTimeout(r, 0))
type El = HTMLElement & { updateComplete: Promise<boolean> }
const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await tick(); await el.updateComplete } }
const q = (el: El, s: string) => el.shadowRoot!.querySelector(s) as HTMLElement
const qa = (el: El, s: string) => [...el.shadowRoot!.querySelectorAll(s)] as HTMLElement[]

const stubDock = () => {
  const calls: unknown[][] = []
  const d = document.createElement('div') as any
  d.id = 'd1'; d.windowStyle = 'tabs'
  for (const m of ['connections', 'saveAs', 'save', 'restore', 'reset']) d[m] = () => calls.push([m])
  d.setWindowStyle = (s: string) => { calls.push(['setWindowStyle', s]); d.windowStyle = s }
  document.body.append(d)
  return calls
}
const mount = async (narrow = false) => {
  ;(globalThis as any).matchMedia = () => ({ matches: narrow, addEventListener() {}, removeEventListener() {} })
  const calls = stubDock()
  const rt = Runtimes.create(Registries.create('page')), reg = rt.registry
  provide(document, reg)
  const id = controlsId('d1')
  reg.add(id, Components.instantiate(WorkspaceControls))
  await rt.call({ registry: 'page', instance: 't' }, id, Ops.key(WorkspaceControls.ops.attach), 'd1')
  const el = new WorkspaceControlsEl() as unknown as El
  el.setAttribute('name', id)
  document.body.append(el); await settle(el)
  return { el, calls, reg }
}
afterEach(() => { document.body.innerHTML = '' })

test('the controls drive their dock', () => {
  const calls = stubDock()
  const c = Components.instantiate(WorkspaceControls).value as any
  expect(() => c.save()).toThrow('no dock ')
  c.attach('d1')
  expect(c.dock).toBe('d1'); expect(c.style).toBe('tabs')
  for (const m of ['connections', 'saveAs', 'save', 'restore', 'reset']) c[m]()
  expect(calls).toEqual([['connections'], ['saveAs'], ['save'], ['restore'], ['reset']])
  c.setStyle('focus')
  expect(calls.at(-1)).toEqual(['setWindowStyle', 'focus']); expect(c.style).toBe('focus')
  expect(controlsId('d1')).toBe('ws-controls-d1')
})

test('the element shows View Tabs | Clear and five labelled icon buttons', async () => {
  const { el } = await mount()
  const view = qa(el, '.view button')
  expect(view.map(b => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Tabs', 'true'], ['Clear', 'false']])
  const icons = qa(el, 'button[aria-label]')
  expect(icons.map(b => b.getAttribute('aria-label'))).toEqual(['Connections', 'Save as workspace…', 'Save layout', 'Restore', 'Reset'])
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

test('takes the app bar colour', () => {
  const text = (WorkspaceControlsEl.styles as any[]).at(-1).cssText
  expect(text).toContain('color: inherit')
  expect(text.split('\n').filter((l: string) => l.includes('--nano-fg') && !l.includes('.panel'))).toEqual([])
})

test('narrow: the buttons fold into a ⋯ menu', async () => {
  const { el, calls } = await mount(true)
  expect(qa(el, '.view button')).toHaveLength(2)
  const more = q(el, 'button[aria-label="More workspace actions"]')
  expect(qa(el, 'button')).toHaveLength(2 + 1 + 5)   // the five sit hidden in the panel
  expect(q(el, '.panel').hasAttribute('hidden')).toBe(true)
  more.click(); await settle(el)
  expect(more.getAttribute('aria-expanded')).toBe('true')
  expect(qa(el, '.panel button').map(b => b.textContent!.trim())).toEqual(['Connections', 'Save as workspace…', 'Save layout', 'Restore', 'Reset'])
  qa(el, '.panel button')[3]!.click(); await settle(el)
  expect(calls).toEqual([['restore']]); expect(more.getAttribute('aria-expanded')).toBe('false')
  more.click(); await settle(el)
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await settle(el)
  expect(more.getAttribute('aria-expanded')).toBe('false')
})
