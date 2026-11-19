/**
 * `<nano-filter>`: a search, and a button with a popover of chip rows per group given.
 */
import { expect, test } from 'bun:test'
const { defineViews, emptyFilter } = await import('../../src/index.ts')
import type { FilterValue } from '../../src/index.ts'

defineViews()
type F = HTMLElement & { groups: unknown; value: FilterValue; updateComplete: Promise<unknown> }
async function mount(groups: unknown, value = emptyFilter()) {
  const el = document.createElement('nano-filter') as F
  el.groups = groups; el.value = value
  document.body.replaceChildren(el)
  await el.updateComplete
  return el
}
const $$ = (el: F, sel: string) => [...el.shadowRoot!.querySelectorAll<HTMLElement>(sel)]
const open = async (el: F) => { await el.updateComplete }   // the panel is always in the DOM; the browser shows it

test('renders a chip per option of each group given; no group, no row', async () => {
  const el = await mount({ kinds: ['pod', 'action'], statuses: ['running'] })
  await open(el)
  expect($$(el, '.row').length).toBe(2)
  expect($$(el, '.row button').map(b => b.textContent!.trim())).toEqual(['pod', 'action', 'running'])
})

test('typing emits change with text', async () => {
  const el = await mount({})
  let got: FilterValue | undefined
  el.addEventListener('change', e => { got = (e as CustomEvent<FilterValue>).detail })
  const input = el.shadowRoot!.querySelector('input')!
  input.value = 'ab'; input.dispatchEvent(new Event('input'))
  expect(got!.text).toBe('ab')
})

test('a chip toggles into the set and emits', async () => {
  const el = await mount({ kinds: ['pod'] })
  const got: FilterValue[] = []
  el.addEventListener('change', e => got.push((e as CustomEvent<FilterValue>).detail))
  await open(el)
  $$(el, '.row button')[0]!.click()
  expect([...got[0]!.kinds]).toEqual(['pod'])
  el.value = got[0]!; await el.updateComplete
  expect($$(el, '.row button')[0]!.getAttribute('aria-pressed')).toBe('true')
  $$(el, '.row button')[0]!.click()
  expect(got[1]!.kinds.size).toBe(0)
})

test('the button counts active chips', async () => {
  const f = emptyFilter(); f.kinds.add('pod'); f.statuses.add('failed')
  const el = await mount({ kinds: ['pod'], statuses: ['failed'] }, f)
  expect($$(el, 'button.toggle')[0]!.textContent).toBe('Filter (2 active)')
})

test('each group heading counts its chosen chips, and shows nothing at zero', async () => {
  const f = emptyFilter(); f.kinds.add('pod'); f.kinds.add('action')
  const el = await mount({ kinds: ['pod', 'action'], namespaces: ['nano.ui'] }, f)
  expect($$(el, '#h-kinds .n').map(b => b.textContent)).toEqual(['2'])
  expect($$(el, '#h-namespaces .n')).toHaveLength(0)
})

test('the button names the popover it controls; with nothing active its name is plain', async () => {
  const el = await mount({ kinds: ['pod'] })
  const b = $$(el, 'button.toggle')[0]!
  expect(b.textContent).toBe('Filter')
  expect(b.getAttribute('aria-haspopup')).toBe('true')
  expect(b.getAttribute('aria-expanded')).toBe('false')
  expect(el.shadowRoot!.getElementById(b.getAttribute('aria-controls')!)!.getAttribute('popover')).toBe('auto')
})

test('each row is a group labelled by its name', async () => {
  const el = await mount({ kinds: ['pod'], statuses: ['failed'] })
  const named = $$(el, '.row').map(r => r.getAttribute('role') + ':' + el.shadowRoot!.getElementById(r.getAttribute('aria-labelledby')!)!.textContent)
  expect(named).toEqual(['group:Type', 'group:Status'])
})

test('closing the panel with focus outside it leaves focus alone; with focus inside it returns it to the button', async () => {
  const el = await mount({ kinds: ['pod'] })
  const panel = el.shadowRoot!.querySelector<HTMLElement>('#panel')!, button = el.shadowRoot!.querySelector<HTMLElement>('.toggle')!
  const outside = document.createElement('input'); document.body.append(outside)
  const close = () => panel.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }))
  outside.focus(); close()
  expect(document.activeElement).toBe(outside)
  $$(el, '.row button')[0]!.focus(); close()
  expect(el.shadowRoot!.activeElement).toBe(button)
})
