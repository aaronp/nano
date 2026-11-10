// The kit: the pieces that need only CSS, in shadcn's look, through --nano-* tokens. Use it beside `base`
// (`static styles = [base, kit]`); a page can adopt it too (`document.adoptedStyleSheets.push(kit.styleSheet!)`).
import { css } from 'lit'
import { t } from './tokens'

const shadow = css`0 8px 24px color-mix(in srgb, black 18%, transparent), 0 1px 3px color-mix(in srgb, black 10%, transparent)`

/** Avatar, bubble, kbd, input group, toggle, switch, dialog, drawer, popover surface, menu items, toast. */
export const kit = css`
  /* people and messages */
  .avatar { display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; overflow: hidden; flex: none;
    background: ${t('surface-2')}; color: ${t('fg-2')}; font-size: 12px; font-weight: 600 }
  .avatar > img { width: 100%; height: 100%; object-fit: cover }
  .avatar.small { width: 24px; height: 24px; font-size: 10px } .avatar.large { width: 40px; height: 40px; font-size: 14px }
  .avatar-stack { display: inline-flex } .avatar-stack > .avatar { box-shadow: 0 0 0 2px ${t('bg')} } .avatar-stack > .avatar + .avatar { margin-left: -8px }
  .bubble { max-width: 75%; width: fit-content; padding: 8px 12px; border-radius: ${t('radius')}; background: ${t('surface-2')}; color: ${t('fg')}; line-height: 1.45 }
  .bubble.mine { margin-left: auto; background: ${t('accent')}; color: ${t('on-accent')} }
  .kbd { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 4px;
    border: 1px solid ${t('border')}; background: ${t('surface-2')}; color: ${t('muted')}; font: 500 11px ${t('font-mono')} }
  .code { font: 12px/1.55 ${t('font-mono')}; background: ${t('surface-2')}; border: 1px solid ${t('border')}; border-radius: ${t('radius-s')};
    padding: 10px 12px; margin: 0; overflow: auto; white-space: pre; color: ${t('fg')} }

  /* inputs */
  .input-group { display: flex; align-items: center; border: 1px solid ${t('border-strong')}; border-radius: ${t('radius-s')}; background: ${t('bg')} }
  .input-group:focus-within { outline: 2px solid ${t('focus')}; outline-offset: 1px }
  .input-group > input, .input-group > .input { flex: 1; min-width: 0; border: 0; background: transparent; outline: 0 }
  .input-group > .addon { padding: 0 8px; color: ${t('muted')}; font-size: 12px; white-space: nowrap }
  .input-group > button { border: 0; border-radius: 0; align-self: stretch }
  .toggle { border-color: transparent } .toggle:hover { color: ${t('fg')} }
  .toggle[aria-pressed='true'] { background: ${t('surface-2')}; border-color: transparent; color: ${t('fg')} }
  .toggle-group { display: inline-flex; border: 1px solid ${t('border')}; border-radius: ${t('radius-s')}; overflow: hidden }
  .toggle-group > button { border: 0; border-radius: 0 } .toggle-group > button + button { border-left: 1px solid ${t('border')} }
  input[type='checkbox'].switch { appearance: none; width: 32px; height: 18px; border-radius: 999px; border: 0; padding: 0; cursor: pointer;
    background: radial-gradient(circle at 9px 50%, ${t('bg')} 6px, transparent 7px), ${t('border-strong')}; transition: background-position .15s }
  input[type='checkbox'].switch:checked { background: radial-gradient(circle at calc(100% - 9px) 50%, ${t('on-accent')} 6px, transparent 7px), ${t('accent')} }

  /* overlays: native <dialog> (showModal()) and [popover] surfaces */
  dialog.dialog, dialog.drawer { color: ${t('fg')}; background: ${t('surface')}; border: 1px solid ${t('border')}; box-shadow: ${shadow}; padding: 20px }
  dialog.dialog { border-radius: ${t('radius')}; width: min(480px, calc(100vw - 32px)) }
  dialog.drawer { margin: 0 0 0 auto; height: 100dvh; max-height: none; width: min(380px, 90vw); border-width: 0 0 0 1px; animation: nano-in-right .2s ease-out }
  dialog.drawer.bottom { margin: auto 0 0; width: 100vw; max-width: none; height: auto; max-height: 80dvh; border-width: 1px 0 0;
    border-radius: ${t('radius')} ${t('radius')} 0 0; animation-name: nano-in-up }
  dialog::backdrop { background: color-mix(in srgb, black 50%, transparent) }
  dialog > header { margin-bottom: 12px } dialog > header > h2 { margin: 0 0 4px; font: 600 16px ${t('font-display')} }
  dialog > header > p { margin: 0; color: ${t('muted')} }
  dialog > footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px }
  @keyframes nano-in-right { from { transform: translateX(100%) } }
  @keyframes nano-in-up { from { transform: translateY(100%) } }
  .pop { position: fixed; inset: auto; margin: 0; min-width: 8rem; padding: 4px; color: ${t('fg')}; background: ${t('surface')};
    border: 1px solid ${t('border')}; border-radius: ${t('radius-s')}; box-shadow: ${shadow}; font-family: ${t('font')}; font-size: 13px }
  .menu-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border: 0; border-radius: ${t('radius-s')};
    background: none; color: inherit; font: inherit; text-align: left; cursor: default; justify-content: flex-start }
  .menu-item:is(:hover, .active) { background: ${t('surface-2')} }
  .menu-item.danger { color: ${t('bad')} } .menu-item[aria-disabled='true'] { opacity: .5 }
  .menu-sep { height: 1px; margin: 4px -4px; background: ${t('border')} }
  .menu-label { padding: 6px 8px 2px; font-size: 11px; font-weight: 600; color: ${t('muted')} }
  .shortcut { margin-left: auto; font-size: 11px; letter-spacing: .08em; color: ${t('muted')} }

  /* toast */
  .toast { display: flex; gap: 10px; align-items: flex-start; width: min(356px, calc(100vw - 32px)); padding: 12px 14px; color: ${t('fg')};
    background: ${t('surface')}; border: 1px solid ${t('border')}; border-radius: ${t('radius')}; box-shadow: ${shadow}; animation: nano-in-up .2s ease-out }
  .toast > .body { flex: 1 } .toast .title { font-weight: 600 } .toast .desc { color: ${t('muted')}; margin-top: 2px }
  .toast.good { border-left: 3px solid ${t('good')} } .toast.bad { border-left: 3px solid ${t('bad')} } .toast.warn { border-left: 3px solid ${t('warn')} }
`
