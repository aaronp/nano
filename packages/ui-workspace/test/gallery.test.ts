// <nano-gallery>: the component library, its layouts and live widgets, in the page's theme or every theme at once.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'

await import('../src/components/gallery.ts')
const { THEME_IDS, schemesOf } = await import('../src/lib/themes.ts')
type El = HTMLElement & { updateComplete: Promise<boolean> }
const tick = () => new Promise(r => setTimeout(r, 0))

const mount = async () => {
  document.body.innerHTML = '<nano-gallery></nano-gallery>'
  const g = document.querySelector('nano-gallery') as El
  await g.updateComplete
  const $ = (s: string) => g.shadowRoot!.querySelector(s) as HTMLElement | null
  const $$ = (s: string) => [...g.shadowRoot!.querySelectorAll(s)] as HTMLElement[]
  const tab = async (name: string) => { $$('.bar [role="tab"]').find(t => t.textContent!.trim() === name)!.click(); await g.updateComplete; await tick() }
  return { g, $, $$, tab }
}

test('the tabs show the primitives, type and colour, layouts and live widgets', async () => {
  const { $, $$, tab } = await mount()
  expect($$('.bar [role="tab"]').map(t => t.textContent!.trim())).toEqual(['Primitives', 'Pickers & inputs', 'Overlays', 'Data', 'Agent', 'Type & colour', 'Layouts', 'Live'])
  for (const c of ['.btn.primary', '.badge.good', '.chip', '.pill', '.card', '.alert.bad', '.field', '.meter', '.table', '.tabs']) expect($('.sample ' + c), c).not.toBeNull()
  await tab('Type & colour')
  expect($$('.swatch').length).toBeGreaterThanOrEqual(20)
  expect($('.display-l')).not.toBeNull()
  await tab('Layouts')
  expect($$('[data-layout]').map(l => l.dataset.layout)).toEqual(['cards', 'list', 'form', 'dashboard', 'table'])
  await tab('Live')
  expect(['ex-range', 'ex-debounce', 'ex-log', 'ex-input', 'ex-map'].every(n => $('[name="' + n + '"]'))).toBe(true)
})

test('the kit tabs show the pickers, overlays, data and agent pieces', async () => {
  const { $, tab } = await mount()
  const has = (sels: string[]) => { for (const s of sels) expect($(s), s).not.toBeNull() }
  await tab('Pickers & inputs')
  has(['nano-select:not([multiple])', 'nano-select[multiple]', 'nano-date-picker', 'nano-calendar', 'nano-command', '.input-group', '.toggle-group', 'input.switch', 'select'])
  await tab('Overlays')
  has(['dialog.dialog', 'dialog.drawer', 'dialog.drawer.bottom', 'nano-hover-card', 'nano-menu', '[data-toast]'])
  ;($('[data-open="demo-dialog"]') as HTMLElement).click()
  await tab('Data')
  has(['nano-data-table', '.avatar-stack', '.bubble.mine', '.kbd', 'nano-code-block'])
  await tab('Agent')
  has(['nano-subagent', 'nano-tool', 'nano-task', 'nano-cli', 'nano-trace', 'nano-test-results'])
})

test('compare shows the primitives once per theme and scheme, each column carrying its own tokens', async () => {
  const { $, $$ } = await mount()
  ;($('[data-compare]') as HTMLInputElement).click(); await tick()
  const cols = $$('.compare > .theme-col')
  expect(cols.length).toBe(THEME_IDS.reduce((n, id) => n + schemesOf(id).length, 0))
  for (const c of cols) { expect(c.style.getPropertyValue('--nano-accent')).toBeTruthy(); expect(c.querySelector('.btn.primary')).not.toBeNull() }
  expect(cols.map(c => c.dataset.theme)).toContain('warm/light')
})

test('each compare column sets its colour scheme, so native pickers match it', async () => {
  const { $, $$ } = await mount()
  ;($('[data-compare]') as HTMLInputElement).click(); await tick()
  const cols = $$('.compare > .theme-col')
  expect(cols.find(c => c.dataset.theme === 'terminal/dark')!.style.colorScheme).toBe('dark')
  expect(cols.find(c => c.dataset.theme === 'paper/light')!.style.colorScheme).toBe('light')
})

test('the page has a Components route and dock widget for it', async () => {
  const page = await Bun.file(new URL('../public/index.html', import.meta.url)).text()
  expect(page).toMatch(/<app-route path="\/components"[^>]*>\s*<nano-gallery>/)
  expect(page).toContain('<template data-widget="nano-gallery" data-title="Components gallery"><nano-gallery></nano-gallery></template>')
})
