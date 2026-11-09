// Every workspace theme gives widgets the whole --nano-* contract; the Decision Ledger themes are here.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'

const { NANO_TOKENS } = await import('@pritzlaff/nano-elements')
const { THEMES, THEME_IDS, schemesOf } = await import('../src/lib/themes.ts')
const { nanoVars } = await import('../src/lib/nano-vars.ts')
const { applyChoice } = await import('../src/lib/theme-state.ts')

test('every theme, in each of its schemes, sets every --nano-* token', () => {
  for (const id of THEME_IDS) for (const s of schemesOf(id)) {
    const vars = nanoVars(id, s)
    expect(Object.keys(vars).sort()).toEqual(Object.keys(NANO_TOKENS).map(k => `--nano-${k}`).sort())
    for (const [k, v] of Object.entries(vars)) expect(v, `${id}/${s} ${k}`).toBeTruthy()
  }
})

test('the Decision Ledger themes, single-scheme, with their own colours', () => {
  expect(THEMES.paper.label).toBe('Graph paper'); expect(schemesOf('paper')).toEqual(['light'])
  expect(THEMES.night.label).toBe('Night shift'); expect(schemesOf('night')).toEqual(['dark'])
  expect(THEMES.blueprint.label).toBe('Blueprint'); expect(schemesOf('blueprint')).toEqual(['dark'])
  expect(THEMES.warm.label).toBe('Warm ledger'); expect(schemesOf('warm')).toEqual(['light'])
  expect(nanoVars('warm', 'light')['--nano-accent']).toBe('#8A3B1F')
  expect(nanoVars('blueprint', 'dark')['--nano-s2']).toBe('#FFB347')
})

test('applying a theme sets the --nano-* tokens, and its page background, on the root', () => {
  applyChoice(document, { theme: 'paper', mode: 'system' })
  const root = document.documentElement.style
  expect(root.getPropertyValue('--nano-accent')).toBe('#1F45B0')
  expect(root.getPropertyValue('--page-bg')).toContain('linear-gradient')
  applyChoice(document, { theme: 'enterprise', mode: 'light' })
  expect(root.getPropertyValue('--nano-accent')).toBe(THEMES.enterprise.schemes.light.accent)
  expect(root.getPropertyValue('--page-bg')).toBe('none')
})
