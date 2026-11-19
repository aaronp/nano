// <nano-tree>'s styles.
import { css } from 'lit'
import { t } from '../tokens'

export const treeStyles = css`
    :host { display: block } ul { list-style: none; margin: 0; padding: 0 }
    ul.group { margin-left: 15px; padding-left: 8px; border-left: 1px solid ${t('border')} }
    li[role='treeitem'] { outline: 0 } li[role='treeitem']:focus-visible > .line { outline: 2px solid ${t('focus')}; outline-offset: -2px }
    .line { display: flex; align-items: center; gap: 6px; padding: 5px 8px; margin: 1px 0; border-radius: ${t('radius-s')}; cursor: pointer; min-width: 0 }
    .line:hover { background: ${t('surface-2')} } li[aria-selected='true'] > .line { background: ${t('accent-soft')} }
    .chev { flex: none; width: 16px; cursor: pointer; text-align: center; color: ${t('muted')}; transition: transform .15s; user-select: none }
    li[data-mark] > .line { background: ${t('warn-bg')}; box-shadow: inset 3px 0 ${t('warn')} } li[data-mark][aria-selected='true'] > .line { background: ${t('accent-soft')} }
    li[aria-expanded='true'] > .line .chev { transform: rotate(90deg) }
    .label { overflow-wrap: anywhere } .kind { color: ${t('muted')}; font-size: 11px; letter-spacing: .06em; text-transform: uppercase }
    .count { color: ${t('muted')}; font-size: 11px; font-variant-numeric: tabular-nums }
    .tag { font-size: 11px; padding: 2px 7px; border-radius: ${t('radius-s')}; background: ${t('accent-soft')}; white-space: nowrap }
    .icon { flex: none; display: inline-flex; align-items: center; gap: 4px } .end { margin-left: auto; display: inline-flex; align-items: center; gap: 4px }
    .body { padding: 2px 8px 6px 30px; color: ${t('muted')}; font-size: 12px }
    mark { background: ${t('warn-bg')}; color: inherit; border-radius: 2px } .empty { color: ${t('muted')}; padding: 12px }
    @media (pointer: coarse) { .line { min-height: 44px } }`
