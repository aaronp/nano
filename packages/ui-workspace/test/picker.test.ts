// pick(): <nano-picker>, a popover listing what a dock can add, by section, with a filter; resolves with the choice or null.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { afterEach, expect, test } from 'bun:test'

const { pick } = await import('../src/components/picker.ts')
const { setImportFailures } = await import('../src/lib/import-failures.ts')

const open = (hidden?: { widget: string; name?: string }[]) => {
  document.body.innerHTML = `<button id="plus">+</button><div id="dock">
    <template data-widget="range" data-title="Range" data-catalog></template><template data-widget="log" data-title="Log" data-catalog></template>
    <template data-widget="notes" data-title="Notes"></template>
    <template data-widget="timer" data-title="Timer" data-catalog data-package="nano-template" data-package-url="https://x/manifest.json"></template></div>`
  const templates = () => [...document.querySelectorAll<HTMLTemplateElement>('#dock > template')]
  const chosen = pick(document.getElementById('plus')!, { templates: templates(), hidden })
  const p = document.querySelector('nano-picker') as HTMLElement
  const entries = (section: string) => [...p.querySelectorAll<HTMLElement>(`[data-section="${section}"] [data-widget]`)].filter(e => !e.hidden).map(e => e.textContent!.trim())
  return { p, chosen, entries }
}
afterEach(() => { document.body.innerHTML = '' })

test('sections and their entries from the given templates; the filter is focused; no Hidden section without hidden panels', () => {
  const { p, entries } = open()
  expect(entries('components')).toEqual(['Range', 'Log'])
  expect(entries('widgets')).toEqual(['Notes'])
  expect(entries('imported')).toEqual(['Timer'])
  expect(p.querySelector('[data-section="imported"] h4')!.textContent).toContain('nano-template')
  expect(p.querySelector('[data-section="hidden"]')).toBeNull()
  expect(document.activeElement).toBe(p.querySelector('input'))
})

test('the filter hides entries and sections that do not match', () => {
  const { p, entries } = open()
  const f = p.querySelector('input')!
  f.value = 'no'; f.dispatchEvent(new Event('input'))
  expect(entries('components')).toEqual([])
  expect(entries('widgets')).toEqual(['Notes'])
  expect((p.querySelector('[data-section="components"]') as HTMLElement).hidden).toBe(true)
})

test('a click resolves with that entry and removes the popover', async () => {
  const { p, chosen } = open()
  ;(p.querySelector('[data-section="widgets"] [data-widget="notes"]') as HTMLElement).click()
  expect(await chosen).toEqual({ widget: 'notes' })
  expect(document.querySelector('nano-picker')).toBeNull()
})

test('a Hidden entry resolves with its widget and name', async () => {
  const { p, chosen, entries } = open([{ widget: 'notes', name: 'Ideas' }])
  expect(entries('hidden')).toEqual(['Ideas'])
  ;(p.querySelector('[data-section="hidden"] [data-widget]') as HTMLElement).click()
  expect(await chosen).toEqual({ widget: 'notes', name: 'Ideas' })
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
  expect(entries('imported')).toEqual([])
  expect(p.querySelector('[data-section="imported"]')!.textContent).toContain('https://dead/manifest.json: not found')
  setImportFailures([])
})
