import { css, unsafeCSS, type CSSResult } from 'lit'

/**
 * The theme contract: CSS custom properties `--c-<name>`, each with a default. Components opt in by using `t.<name>`
 * in their styles (which falls back to the default when no theme is set); hosts theme everything below an element
 * by setting the properties on it, e.g. `applyTheme(document.documentElement, themes.dark)`. Custom properties pass
 * through shadow DOM, so no JavaScript runs inside components.
 */
export const tokens = {
  bg: '#ffffff',          // component background
  surface: '#f5f5f4',     // insets: inputs, table headers, code
  fg: '#1c1917',          // text
  muted: '#78716c',       // secondary text
  line: '#e7e5e4',        // borders and dividers
  accent: '#2563eb',      // primary actions, highlights, chart lines
  'accent-fg': '#ffffff', // text on accent
  danger: '#dc2626',
  radius: '6px',
  gap: '8px',             // space between controls
  font: 'system-ui, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const
export type Token = keyof typeof tokens
export type Theme = Partial<Record<Token, string>>

/** `t.accent` → `var(--c-accent, #2563eb)`, ready for a Lit `css` template. */
export const t = Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, unsafeCSS(`var(--c-${k}, ${v})`)])) as Record<Token, CSSResult>

/** Set a theme's properties on `el` (and so on everything inside it). Unset tokens keep their defaults. */
export const applyTheme = (el: HTMLElement, theme: Theme) => {
  for (const k of Object.keys(tokens) as Token[]) {
    if (theme[k] === undefined) el.style.removeProperty(`--c-${k}`)
    else el.style.setProperty(`--c-${k}`, theme[k]!)
  }
}

export const themes = {
  light: {} as Theme,
  dark: {
    bg: '#1c1917', surface: '#292524', fg: '#f5f5f4', muted: '#a8a29e', line: '#44403c',
    accent: '#60a5fa', 'accent-fg': '#0c0a09', danger: '#f87171',
  } as Theme,
}

/** Opt-in base styles for a themed view: font, colours, and plain controls. Use `static styles = [base, css`…`]`. */
export const base = css`
  :host { display: block; font: 14px/1.4 ${t.font}; color: ${t.fg}; }
  input, button { font: inherit; color: inherit; border-radius: ${t.radius}; border: 1px solid ${t.line}; padding: 4px 8px; }
  input { background: ${t.surface}; }
  button { background: ${t.accent}; color: ${t['accent-fg']}; border-color: transparent; cursor: pointer; }
  button:focus-visible, input:focus-visible { outline: 2px solid ${t.accent}; outline-offset: 1px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid ${t.line}; }
  th { background: ${t.surface}; color: ${t.muted}; font-weight: 500; }
  code { font-family: ${t.mono}; font-size: 0.9em; }
`
