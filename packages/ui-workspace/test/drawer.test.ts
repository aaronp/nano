// <component-drawer>: a workspace page's list of what its dock can add, by section, with a filter and a collapse.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'

await import('../src/components/component-drawer.ts')
// a stand-in dock: the drawer reads its templates and hands it each entry
const added: string[] = []
customElements.define('workspace-dock', class extends HTMLElement { addSource(el: HTMLElement) { added.push(el.dataset.widget!) } })
const tick = () => new Promise(r => setTimeout(r, 0))

const mount = async () => {
  added.length = 0
  document.body.innerHTML = `<component-drawer for="ws"></component-drawer>
    <workspace-dock id="ws"><template data-widget="range" data-title="Range" data-catalog><c-range></c-range></template>
      <template data-widget="log" data-title="Log" data-catalog></template><template data-widget="notes" data-title="Notes"></template></workspace-dock>`
  await tick()
  const d = document.querySelector('component-drawer') as HTMLElement
  const entries = (section: string) => [...d.querySelectorAll(`[data-section="${section}"] a`)].filter(a => !(a as HTMLElement).hidden).map(a => a.textContent!.trim())
  return { d, entries }
}

test('entries from the dock\'s palette, by section, each a drag source and click-to-add for that dock', async () => {
  const { d, entries } = await mount()
  expect(entries('components')).toEqual(['Range', 'Log'])
  expect(entries('widgets')).toEqual(['Notes'])
  expect(added).toEqual(['range', 'log', 'notes'])
  expect(d.querySelector('a[data-widget="range"]')!.getAttribute('data-dock-add')).toBe('ws')
  const imp = [...d.querySelectorAll('button')].find(b => b.textContent!.trim() === 'Import') as HTMLButtonElement
  expect(imp.disabled).toBe(true)
})

test('the filter hides entries and sections that do not match', async () => {
  const { d, entries } = await mount()
  const f = d.querySelector('input[type="search"]') as HTMLInputElement
  f.value = 'no'; f.dispatchEvent(new Event('input'))
  expect(entries('components')).toEqual([])
  expect(entries('widgets')).toEqual(['Notes'])
  expect((d.querySelector('[data-section="components"]') as HTMLElement).hidden).toBe(true)
})

test('hiding takes the drawer away completely; a toggle elsewhere (beside + in the nav) brings it back; remembered', async () => {
  localStorage.clear(); document.documentElement.removeAttribute('data-drawers-hidden')
  let { d } = await mount()
  document.body.insertAdjacentHTML('beforeend', '<button data-toggle-drawer aria-pressed="true">nav</button>')
  const nav = () => document.querySelector('body > [data-toggle-drawer]') as HTMLButtonElement
  ;(d.querySelector('[aria-label="Hide the components drawer"]') as HTMLButtonElement).click()
  expect(document.documentElement.hasAttribute('data-drawers-hidden')).toBe(true)
  expect(nav().getAttribute('aria-pressed')).toBe('false')
  document.documentElement.removeAttribute('data-drawers-hidden')
  ;({ d } = await mount())   // a reload
  const { restoreDrawers } = await import('../src/components/component-drawer.ts')
  restoreDrawers(document)
  expect(document.documentElement.hasAttribute('data-drawers-hidden')).toBe(true)
  document.body.insertAdjacentHTML('beforeend', '<button data-toggle-drawer>nav</button>')
  nav().click()
  expect(document.documentElement.hasAttribute('data-drawers-hidden')).toBe(false)
  expect(nav().getAttribute('aria-pressed')).toBe('true')
})
