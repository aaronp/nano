/**
 * `<nano-filter>`: a search, and a button with a popover of chip rows per group given; kindIcon and statusDot.
 */
import { expect, test } from 'bun:test'
const { defineViews, emptyFilter, kindIcon, statusDot } = await import('../../src/index.ts')
const { render } = await import('lit')
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
const open = async (el: F) => { $$(el, 'button.toggle')[0]!.click(); await el.updateComplete }

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
  expect($$(el, 'button.toggle')[0]!.textContent).toContain('2')
})

test('kindIcon and statusDot render an svg with a title per kind and status', () => {
  const host = document.createElement('div')
  for (const k of ['pod', 'interface', 'implementation', 'action', 'event', 'runtime', 'other']) {
    render(kindIcon(k) as never, host)
    expect(host.querySelector('svg title')!.textContent).toBe(k)
  }
  for (const s of ['running', 'not started', 'stopped', 'failed'] as const) {
    render(statusDot(s) as never, host)
    expect(host.querySelector('svg title')!.textContent).toBe(s)
  }
})
