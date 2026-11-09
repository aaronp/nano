// The component library: the shared stylesheet every nano element adopts. Every colour, font and radius comes from a
// --nano-* token (see tokens.ts), so elements take on their host's theme. Bare controls are styled too, so markup
// without the classes still looks right.
import { css } from 'lit'
import { t } from './tokens'

/** The library: host type, bare controls, and the classes (buttons, labels, cards, forms, tables, type, layout). */
export const base = css`
  :host { display: block; font-family: ${t('font')}; font-size: 13px; color: ${t('fg')} }
  :focus-visible { outline: 2px solid ${t('focus')}; outline-offset: 1px }

  /* buttons */
  button, .btn { font: inherit; font-size: 12px; color: ${t('fg')}; background: transparent; border: 1px solid ${t('border-strong')};
    border-radius: ${t('radius-s')}; padding: 5px 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px }
  button:hover, .btn:hover { background: ${t('surface-2')} }
  button:disabled, .btn:disabled { opacity: .5; cursor: not-allowed }
  button.primary, .btn.primary { color: ${t('on-accent')}; background: ${t('accent')}; border-color: ${t('accent')}; font-weight: 600 }
  button.danger, .btn.danger { color: ${t('bad')}; border-color: ${t('bad')} }
  button.dashed, .btn.dashed { border-style: dashed; font-weight: 600 }
  .btn.small { font-size: 11px; padding: 2px 7px }
  .icon-btn { border: 0; background: transparent; padding: 4px; border-radius: ${t('radius-s')}; color: ${t('muted')} }
  .icon-btn:hover { color: ${t('fg')}; background: ${t('surface-2')} }
  button[aria-pressed='true'], .btn[aria-pressed='true'] { background: ${t('surface-2')}; border-color: ${t('accent')} }

  /* labels */
  .badge { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; background: ${t('surface-2')}; color: ${t('fg-2')} }
  .badge.good { background: ${t('good-bg')}; color: ${t('good')} } .badge.bad { background: ${t('bad-bg')}; color: ${t('bad')} }
  .badge.warn { background: ${t('warn-bg')}; color: ${t('warn')} } .badge.accent { background: ${t('accent-soft')}; color: ${t('accent')} }
  .chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border: 1px solid ${t('border')}; border-radius: ${t('radius-s')}; font-size: 12px }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; background: ${t('surface-2')}; font-size: 12px }
  .pill::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor }

  /* containers and states */
  .card { background: ${t('surface')}; border: 1px solid ${t('border')}; border-radius: ${t('radius')}; padding: 12px }
  .alert { padding: 8px 12px; border-radius: ${t('radius-s')}; border: 1px solid ${t('border')}; background: ${t('surface-2')} }
  .alert.good { background: ${t('good-bg')}; color: ${t('good')}; border-color: transparent }
  .alert.bad, .problem { color: ${t('bad')} } .alert.bad { background: ${t('bad-bg')}; border-color: transparent }
  .problem { font-size: 12px }

  /* forms */
  input, select, textarea, .input { font: inherit; font-size: 12px; color: ${t('fg')}; background: ${t('bg')}; border: 1px solid ${t('border-strong')};
    border-radius: ${t('radius-s')}; padding: 4px 6px }
  input[type='range'], input[type='checkbox'] { accent-color: ${t('accent')}; padding: 0 }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: ${t('muted')} }
  .meter { height: 6px; border-radius: 3px; background: ${t('surface-2')}; overflow: hidden }
  .meter > span { display: block; height: 100%; background: ${t('accent')} }

  /* data */
  .table { width: 100%; border-collapse: collapse } .table th, .table td { text-align: left; padding: 5px 8px; border-bottom: 1px solid ${t('border')} }
  .table th { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: ${t('muted')} }
  .tabs { display: flex; gap: 2px; border-bottom: 1px solid ${t('border')} }
  .tabs > button { border: 0; border-radius: 0; border-bottom: 2px solid transparent; background: none; color: ${t('muted')} }
  .tabs > button[aria-selected='true'] { color: ${t('fg')}; border-bottom-color: ${t('accent')} }
  .list-row { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-bottom: 1px solid ${t('border')} }

  /* type */
  .kicker { font-size: 11px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: ${t('muted')} }
  .display-s, .display-m, .display-l { font-family: ${t('font-display')}; font-weight: 600; letter-spacing: -.01em; margin: 0 }
  .display-s { font-size: 18px } .display-m { font-size: 24px } .display-l { font-size: 34px }
  .muted { color: ${t('muted')} }
  .mono { font-family: ${t('font-mono')}; font-size: 11px }

  /* layout */
  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap }
  .col { display: flex; flex-direction: column; gap: 8px }
  .grid-auto { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px }
`
