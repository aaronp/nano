// The prototype's look, shared by every element: dark surfaces, Inter for text, JetBrains Mono for code.
import { css } from 'lit'

/** Base styles for every editor element. */
export const base = css`
  :host { display: block; font-family: Inter, system-ui, sans-serif; font-size: 13px; color: #E7E9EE }
  button { font: inherit; font-size: 12px; color: #E7E9EE; background: transparent; border: 1px solid #3A4150; border-radius: 6px; padding: 5px 10px; cursor: pointer }
  button.primary { color: #0D0F13; background: #6FA8FF; border: 0; font-weight: 600 }
  button.danger { color: #FFB4A8; border-color: #5A3A3A }
  button.dashed { border-style: dashed; border-color: #4A5263; font-weight: 600 }
  button[aria-pressed='true'] { background: #212632; border-color: #6FA8FF }
  input, select { font: inherit; font-size: 12px; color: #E7E9EE; background: #0D0F13; border: 1px solid #3A4150; border-radius: 5px; padding: 4px 6px }
  .muted { color: #A3AAB8 }
  .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px }
  .problem { color: #FFB4A8; font-size: 12px }
  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap }
  .col { display: flex; flex-direction: column; gap: 8px }
  .card { background: #14171D; border: 1px solid #2A303C; border-radius: 8px; padding: 10px }
`
