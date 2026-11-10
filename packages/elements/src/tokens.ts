// The --nano-* token contract: what every nano element reads for colour, type and shape. A host sets these (or maps
// its own variables onto them); custom properties reach inside shadow roots. The fallbacks are the default dark look.
import { unsafeCSS } from 'lit'

/** Every token, with the value an element uses when the host sets none. */
export const NANO_TOKENS = {
  bg: '#0D0F13', surface: '#14171D', 'surface-2': '#212632', border: '#2A303C', 'border-strong': '#3A4150',
  fg: '#E7E9EE', 'fg-2': '#C9CED6', muted: '#A3AAB8', 'on-accent': '#0D0F13',
  accent: '#6FA8FF', 'accent-soft': '#1C2A44', focus: '#6FA8FF',
  good: '#7EE787', 'good-bg': '#12301C', bad: '#FFB4A8', 'bad-bg': '#3A1D1D', warn: '#F2CC60', 'warn-bg': '#3A3016',
  font: 'Inter, system-ui, sans-serif', 'font-display': 'Inter, system-ui, sans-serif', 'font-mono': "'JetBrains Mono', ui-monospace, monospace",
  radius: '8px', 'radius-s': '6px',
  s1: '#7EE787', s2: '#F5A524', s3: '#4CC2FF', s4: '#FF7AB6', s5: '#D2A8FF', s6: '#FFA657', s7: '#79C0FF', s8: '#F2CC60',
} as const
export type NanoToken = keyof typeof NANO_TOKENS

/** A token for use in `css`: `var(--nano-<name>, <fallback>)`. */
export const t = (name: NanoToken) => unsafeCSS(`var(--nano-${name}, ${NANO_TOKENS[name]})`)
/** The same, as a string, for inline styles and SVG attributes. */
export const tv = (name: NanoToken) => `var(--nano-${name}, ${NANO_TOKENS[name]})`
