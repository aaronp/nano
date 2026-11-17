// <nano-wiring>'s look, on the --nano-* tokens.
import { css } from 'lit'
import { base, t } from '@pritzlaff/nano-elements'

export const styles = [base, css`
  :host { display: block; height: 100%; min-height: 360px; color: ${t('fg')} }
  .pills { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px; background: ${t('bg')} }
  .ic { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; background: ${t('surface-2')}; font-size: 10px }
  .stage { position: relative; height: calc(100% - 44px); overflow: hidden; perspective: 2400px; background: ${t('bg')} radial-gradient(${t('surface-2')} 1px, transparent 1px) 0 0 / 22px 22px; cursor: grab; user-select: none; touch-action: none }
  .world { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform-style: preserve-3d; transform-origin: 0 0 }
  .world.anim { transition: transform .5s ease }
  .frame { position: absolute; transform-style: preserve-3d }
  .layer { position: absolute; left: 0; top: 0; background: ${t('surface')}; border: 1px solid ${t('border')}; border-radius: 8px }
  .ltitle { position: absolute; left: 0; top: -22px; margin: 0; font-size: 12px; color: ${t('muted')}; white-space: nowrap }
  .layer .ltitle { left: 8px; top: 6px }
  .fp { position: absolute; box-sizing: border-box; border: 1px solid ${t('border')}; border-radius: 6px; background: ${t('surface-2')} }
  .ftitle { position: absolute; left: 14px; top: 8px; padding: 0; border: 0; background: none; font-weight: 600 }
  .pad { position: absolute; width: 24px; height: 24px; padding: 0; border: 2px solid; font: 600 10px ${t('font-mono')} }
  .plabel { position: absolute; font-size: 10px; color: ${t('muted')}; white-space: nowrap }
  .pad[aria-pressed="true"], .fp[data-sel="true"] { border-color: ${t('accent')} }
  .hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: stroke; cursor: pointer }
  g[data-cable-hit]:focus-visible { outline: 2px solid ${t('focus')} }
  path[data-lit="true"] { filter: drop-shadow(0 0 4px currentColor) }
  .cables { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none }
  .drawer { position: absolute; top: 0; right: 0; bottom: 0; z-index: 3; width: 340px; max-width: 100%; box-sizing: border-box; padding: 16px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; background: ${t('bg')}; border-left: 1px solid ${t('border')}; cursor: auto; user-select: text }
  .drawer[hidden] { display: none }
  .d-head { display: flex; justify-content: space-between; gap: 12px } .d-title { font: 700 14px ${t('font-mono')}; word-break: break-word } .d-sub { font: 11px ${t('font-mono')}; color: ${t('muted')}; word-break: break-word }
  .kicker { font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: ${t('muted')} }
  .chips { display: flex; flex-wrap: wrap; gap: 6px }
  .glyph { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; color: ${t('on-accent')}; font: 700 9px ${t('font-mono')} }
  dl { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 6px 10px; margin: 0 } dt { color: ${t('muted')} } dd { margin: 0; font: 11px ${t('font-mono')}; word-break: break-word }
  pre { margin: 0; padding: 10px; border: 1px solid ${t('border')}; border-radius: 6px; background: ${t('surface')}; font: 11px/16px ${t('font-mono')}; white-space: pre-wrap }
  .actions { margin-top: auto; padding-top: 8px; border-top: 1px solid ${t('border')} }
  @media (prefers-reduced-motion: reduce) { .world.anim { transition: none } }
  .minimap { position: absolute; right: 12px; bottom: 12px; width: 176px; height: 108px; background: ${t('bg')}; border: 1px solid ${t('border')}; border-radius: 6px }
  .mm-layer { fill: ${t('surface-2')} } .mm-layer[data-focus="true"] { fill: ${t('accent-soft')} } .mm-side { fill: ${t('border')} } .mm-view { fill: none; stroke: ${t('accent')}; stroke-width: 12 }`]
