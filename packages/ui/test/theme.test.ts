import { test, expect } from 'bun:test'
import { applyTheme, t, themes, tokens } from '../src/theme'

test('t gives each token as a custom property with its default as fallback', () => {
  expect(String(t.accent)).toBe(`var(--c-accent, ${tokens.accent})`)
  expect(Object.keys(t)).toEqual(Object.keys(tokens))
})

test('applyTheme sets the given tokens and clears the rest back to their defaults', () => {
  const props = new Map<string, string>()
  const el = { style: { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) } } as unknown as HTMLElement
  applyTheme(el, themes.dark)
  expect(props.get('--c-bg')).toBe(themes.dark.bg!)
  applyTheme(el, { accent: 'hotpink' })
  expect([...props]).toEqual([['--c-accent', 'hotpink']])
})
