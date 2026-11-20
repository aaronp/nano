// pick(): <nano-picker>, a popover listing what a dock can add, by provider, with a filter and runtime pills; resolves with the choice or null.
// pickerGrid(): the same content inline, in a place of its own.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { afterEach, expect, test } from 'bun:test'

const { pick } = await import('../src/components/picker.ts')
const { pickerGrid } = await import('../src/components/picker-grid.ts')
const { setImportFailures } = await import('../src/lib/import-failures.ts')

const open = (hidden?: { widget: string; name?: string }[], runtimes = ['main']) => {
  document.body.innerHTML = `<button id="plus">+</button><div id="dock">
    <template data-widget="range" data-title="Range" data-catalog></template><template data-widget="log" data-title="Log" data-catalog></template>
    <template data-widget="notes" data-title="Notes"></template>
    <template data-widget="timer" data-title="Timer" data-catalog data-package="nano-template" data-package-url="https://x/manifest.json"></template></div>`
  const templates = () => [...document.querySelectorAll<HTMLTemplateElement>('#dock > template')]
  const chosen = pick(document.getElementById('plus')!, { templates: templates(), hidden, runtimes })
  const p = document.querySelector('nano-picker') as HTMLElement
  const entries = (section: string) => [...p.querySelectorAll<HTMLElement>(`[data-section="${section}"] [data-widget]`)].filter(e => !e.hidden).map(e => e.textContent!.trim())
  return { p, chosen, entries }
}
afterEach(() => { document.body.innerHTML = '' })

test('groups by provider (nano.ui, then imports), Views last; entries from the given templates; the filter is focused; no Hidden section without hidden panels', () => {
  const { p, entries } = open()
  expect([...p.querySelectorAll('.np-section')].map(s => (s as HTMLElement).dataset.section)).toEqual(['nano.ui', 'nano-template', 'views'])
  expect(entries('nano.ui')).toEqual(['Range', 'Log'])
  expect(entries('views')).toEqual(['Notes'])
  expect(entries('nano-template')).toEqual(['Timer'])
  expect(p.querySelector('[data-section="nano-template"] h3')!.textContent).toContain('nano-template')
  expect(p.querySelector('[data-section="hidden"]')).toBeNull()
  expect(document.activeElement).toBe(p.querySelector('input'))
})

test('the filter hides entries and sections that do not match', () => {
  const { p, entries } = open()
  const f = p.querySelector('input')!
  f.value = 'no'; f.dispatchEvent(new Event('input'))
  expect(entries('nano.ui')).toEqual([])
  expect(entries('views')).toEqual(['Notes'])
  expect((p.querySelector('[data-section="nano.ui"]') as HTMLElement).hidden).toBe(true)
  expect((p.querySelector('[data-section="nano-template"]') as HTMLElement).hidden).toBe(true)
})

test('a click resolves with that entry and removes the popover', async () => {
  const { p, chosen } = open()
  ;(p.querySelector('[data-section="views"] [data-widget="notes"]') as HTMLElement).click()
  expect(await chosen).toEqual({ state: { widget: 'notes' } })
  expect(document.querySelector('nano-picker')).toBeNull()
})

test('a Hidden entry resolves with its widget and name', async () => {
  const { p, chosen, entries } = open([{ widget: 'notes', name: 'Ideas' }])
  expect(entries('hidden')).toEqual(['Ideas'])
  ;(p.querySelector('[data-section="hidden"] [data-widget]') as HTMLElement).click()
  expect(await chosen).toEqual({ state: { widget: 'notes', name: 'Ideas' } })
})

test('Esc, or a press outside, resolves null and removes the popover', async () => {
  let { p, chosen } = open()
  p.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(await chosen).toBeNull()
  expect(document.querySelector('nano-picker')).toBeNull()
  ;({ p, chosen } = open())
  p.querySelector('input')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))   // inside: stays
  expect(p.isConnected).toBe(true)
  document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  expect(await chosen).toBeNull()
  expect(p.isConnected).toBe(false)
})

test('✕ on an imported package fires imports:remove with its url; failed imports are listed; re-reads on catalog:changed', async () => {
  const { p, entries } = open()
  const removed: unknown[] = []
  document.addEventListener('imports:remove', e => removed.push((e as CustomEvent).detail))
  ;(p.querySelector('[aria-label="Remove nano-template"]') as HTMLElement).click()
  expect(removed).toEqual([{ url: 'https://x/manifest.json', name: 'nano-template' }])
  setImportFailures([{ url: 'https://dead/manifest.json', error: 'not found' }])
  document.querySelector('[data-package]')!.remove()
  document.dispatchEvent(new CustomEvent('catalog:changed'))
  expect(entries('nano-template')).toEqual([])
  expect(p.querySelector('[data-section="failed"]')!.textContent).toContain('https://dead/manifest.json: not found')
  setImportFailures([])
})

test('near the bottom of the viewport it opens above its anchor, in view', () => {
  document.body.innerHTML = '<button id="plus">+</button>'
  const plus = document.getElementById('plus')!
  plus.getBoundingClientRect = () => ({ top: innerHeight - 30, bottom: innerHeight - 10, left: 10, right: 30, width: 20, height: 20, x: 10, y: innerHeight - 30, toJSON() {} }) as DOMRect
  const proto = customElements.get('nano-picker')!.prototype
  Object.defineProperty(proto, 'offsetHeight', { configurable: true, get: () => 300 })
  try {
    void pick(plus, { templates: [], runtimes: ['main'] })
    const top = parseFloat((document.querySelector('nano-picker') as HTMLElement).style.top)
    expect(top).toBe(innerHeight - 30 - 4 - 300)
    expect(top + 300).toBeLessThanOrEqual(innerHeight - 8)
  } finally { delete (proto as { offsetHeight?: number }).offsetHeight }
})

test('a page change (Back) resolves null and removes the popover', async () => {
  const { chosen } = open()
  window.dispatchEvent(new Event('hashchange'))
  expect(await chosen).toBeNull()
  expect(document.querySelector('nano-picker')).toBeNull()
})

const pills = (p: HTMLElement) => [...p.querySelectorAll<HTMLElement>('[role="radiogroup"] [data-runtime]')]
const checked = (p: HTMLElement) => pills(p).filter(b => b.getAttribute('aria-checked') === 'true').map(b => b.dataset.runtime)

test('the pills list the runtimes; the choice comes back with a provider tile, is remembered, and does not for Views or Hidden', async () => {
  let { p, chosen } = open([{ widget: 'notes', name: 'Ideas' }], ['main', 'edge'])
  expect(pills(p).map(b => b.dataset.runtime)).toEqual(['main', 'edge'])
  expect(checked(p)).toEqual(['main'])
  pills(p)[1]!.click()
  expect(checked(p)).toEqual(['edge'])
  ;(p.querySelector('[data-widget="range"]') as HTMLElement).click()
  expect(await chosen).toEqual({ state: { widget: 'range' }, runtime: 'edge' })
  ;({ p, chosen } = open([{ widget: 'notes', name: 'Ideas' }], ['main', 'edge']))
  expect(checked(p)).toEqual(['edge'])   // the session's last choice
  ;(p.querySelector('[data-section="views"] [data-widget]') as HTMLElement).click()
  expect(await chosen).toEqual({ state: { widget: 'notes' } })
  ;({ p, chosen } = open([{ widget: 'notes', name: 'Ideas' }], ['main', 'edge']))
  ;(p.querySelector('[data-section="hidden"] [data-widget]') as HTMLElement).click()
  expect(await chosen).toEqual({ state: { widget: 'notes', name: 'Ideas' } })
  ;({ p, chosen } = open(undefined, ['main']))   // a choice no longer offered: back to main
  expect(checked(p)).toEqual(['main'])
  p.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await chosen
})

test('the pills are disabled while focus is in Views', () => {
  const { p } = open(undefined, ['main', 'edge'])
  ;(p.querySelector('[data-section="views"] [data-widget]') as HTMLElement).focus()
  expect(pills(p).every(b => (b as HTMLButtonElement).disabled)).toBe(true)
  ;(p.querySelector('[data-widget="range"]') as HTMLElement).focus()
  expect(pills(p).some(b => (b as HTMLButtonElement).disabled)).toBe(false)
  ;(p.querySelector('[data-section="views"] [data-widget]') as HTMLElement).focus()
  p.querySelector('input')!.focus()   // out of Views: enabled again
  expect(pills(p).some(b => (b as HTMLButtonElement).disabled)).toBe(false)
})

test('the arrow keys move focus between tiles; Down in the filter enters the grid', () => {
  const { p } = open()
  const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  key(p.querySelector('input')!, 'ArrowDown')
  expect(document.activeElement).toBe(p.querySelector('[data-widget="range"]'))
  key(document.activeElement!, 'ArrowRight')
  expect(document.activeElement).toBe(p.querySelector('[data-widget="log"]'))
  key(document.activeElement!, 'ArrowLeft')
  expect(document.activeElement).toBe(p.querySelector('[data-widget="range"]'))
})

test('inline, the grid fills its place, has no Esc or outside-click close, and a pick resolves it', async () => {
  const host = document.createElement('div'); document.body.append(host)
  host.innerHTML = '<template data-widget="range" data-title="Range" data-catalog></template>'
  const chosen = pickerGrid(host, { templates: [...host.querySelectorAll('template')], runtimes: ['main', 'edge'] })
  expect(document.querySelector('nano-picker')).toBeNull()
  expect(document.activeElement).not.toBe(host.querySelector('input'))
  host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
  window.dispatchEvent(new Event('hashchange'))
  expect(host.querySelector('input')).not.toBeNull()
  expect(host.firstElementChild!.getAttribute('role')).toBe('group')
  pills(host)[1]!.click()
  ;(host.querySelector('[data-widget="range"]') as HTMLElement).click()
  expect(await chosen).toEqual({ state: { widget: 'range' }, runtime: 'edge' })
})

test('the pills are a radio group: one tab stop, the arrows move the choice', () => {
  const { p } = open(undefined, ['main', 'edge'])
  const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  pills(p)[0]!.click()   // (the session may remember another choice)
  expect(pills(p).map(b => b.tabIndex)).toEqual([0, -1])
  pills(p)[0]!.focus(); key(pills(p)[0]!, 'ArrowRight')
  expect(checked(p)).toEqual(['edge']); expect(document.activeElement).toBe(pills(p)[1]!); expect(pills(p).map(b => b.tabIndex)).toEqual([-1, 0])
  key(pills(p)[1]!, 'ArrowLeft'); expect(checked(p)).toEqual(['main'])
})

test('Up and Down move by a row of tiles', () => {
  document.body.innerHTML = ['A', 'B', 'C', 'D'].map(t => `<template data-widget="${t}" data-title="${t}" data-catalog></template>`).join('')
  const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop')
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get(this: HTMLElement) { return 'CD'.includes(this.textContent!) ? 10 : 0 } })
  try {
    void pick(document.body, { templates: [...document.querySelectorAll('template')], runtimes: ['main'] })
    const tile = (w: string) => document.querySelector(`nano-picker [data-widget="${w}"]`) as HTMLElement, key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    tile('A').focus(); key(tile('A'), 'ArrowDown'); expect(document.activeElement).toBe(tile('C'))
    key(tile('C'), 'ArrowUp'); expect(document.activeElement).toBe(tile('A'))
  } finally { if (was) Object.defineProperty(HTMLElement.prototype, 'offsetTop', was); else delete (HTMLElement.prototype as { offsetTop?: number }).offsetTop }
})
