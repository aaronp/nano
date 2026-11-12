// <theme-picker>: a row of swatches (cards on the Themes page), as in the Decision Ledger; the chosen one shows its name.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'

const { createBus, provideBus } = await import('../src/lib/bus.ts')
const { THEMES, THEME_IDS, schemesOf, themeVars } = await import('../src/lib/themes.ts')
const { applyChoice } = await import('../src/lib/theme-state.ts')
await import('../src/components/theme-picker.ts')
type El = HTMLElement & { updateComplete: Promise<boolean> }

test('one swatch button per theme; the chosen one is pressed and named; a click picks a theme', async () => {
  document.body.innerHTML = '<div id="shell"></div>'
  provideBus(document.getElementById('shell')!, createBus())
  applyChoice(document, { theme: 'enterprise', mode: 'light' })
  const p = document.getElementById('shell')!.appendChild(document.createElement('theme-picker')) as El
  await p.updateComplete
  const group = p.shadowRoot!.querySelector('[role="group"][aria-label="Theme"]')!
  const buttons = [...group.querySelectorAll('button.theme-btn')] as HTMLElement[]
  expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(THEME_IDS.map(id => `${THEMES[id].label} theme`))
  expect(buttons.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent!.trim())).toEqual(['Enterprise'])
  expect(buttons[1]!.textContent!.trim()).toBe('')
  const sw = buttons[0]!.querySelector('.swatch') as HTMLElement
  const v = themeVars('enterprise', 'light')
  expect(sw.getAttribute('style')).toContain(v['--bg']!)
  expect(sw.querySelector('span')).not.toBeNull(); expect(sw.querySelector('i')).not.toBeNull()
  buttons.find(b => b.getAttribute('aria-label') === 'Blueprint theme')!.click(); await p.updateComplete
  expect(document.documentElement.dataset['theme']).toBe('blueprint')
  expect([...group.querySelectorAll('[aria-pressed="true"]')].map(b => b.textContent!.trim())).toEqual(['Blueprint'])
  expect(schemesOf('blueprint')).toEqual(['dark'])
})
