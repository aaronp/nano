// The --nano-* token contract, and the component library built on it.
import { expect, test } from 'bun:test'
import { base, NANO_TOKENS, t } from '../src'

const CONTRACT = 'bg surface surface-2 border border-strong fg fg-2 muted on-accent accent accent-soft focus good good-bg bad bad-bg warn warn-bg font font-display font-mono radius radius-s s1 s2 s3 s4 s5 s6 s7 s8'.split(' ')
const cssText = [base].flat().map(s => s.cssText).join('\n')

test('the contract is exactly these tokens, each with a fallback; t() reads one', () => {
  expect(Object.keys(NANO_TOKENS).sort()).toEqual([...CONTRACT].sort())
  for (const v of Object.values(NANO_TOKENS)) expect(v.length).toBeGreaterThan(0)
  expect(String(t('accent'))).toBe(`var(--nano-accent, ${NANO_TOKENS.accent})`)
})

test('the library uses no colour except through a token (with its fallback)', () => {
  const withoutTokens = cssText.replace(/var\(--nano-[a-z0-9-]+, [^)]*\)/g, '')
  expect(withoutTokens.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)).toBeNull()
})

test('the library has the classes a widget can use', () => {
  for (const c of ['.btn', '.btn.primary', '.btn.danger', '.btn.dashed', '.btn.small', '.icon-btn', '.badge', '.chip', '.pill', '.card', '.alert', '.alert.good', '.alert.bad',
    '.field', '.input', '.meter', '.table', '.tabs', '.list-row', '.kicker', '.display-s', '.display-m', '.display-l', '.mono', '.muted', '.row', '.col', '.grid-auto'])
    expect(cssText).toContain(c)
})

test('button labels stay centred, and a pressed or selected tab is marked', () => {
  expect(cssText).toMatch(/button, \.btn \{[^}]*justify-content: center/)
  expect(cssText).toMatch(/\.tabs > button:is\(\[aria-selected='true'\], \[aria-pressed='true'\]\)/)
})
