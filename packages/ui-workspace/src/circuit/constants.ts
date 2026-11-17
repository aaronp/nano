// The circuit view's look: pad colours and glyphs, page and pad geometry, tilt and fade.
import type { PadType } from './types'

export const TYPE_COLOR: Record<PadType, string> = { string: '#2dd4bf', number: '#fbbf24', boolean: '#f472b6', object: '#60a5fa', array: '#a78bfa', signal: '#94a3b8', any: '#e5e7eb' }
export const TYPE_GLYPH: Record<PadType, string> = { string: 'Aa', number: '#', boolean: '?', object: '{}', array: '[]', signal: '•', any: '*' }
export const TYPE_NAME: Record<PadType, string> = { string: 'String', number: 'Number', boolean: 'Boolean', object: 'Object', array: 'Array', signal: 'Signal', any: 'Any' }

/** A page, in world px; page i sits at x = i·XSTEP, so the stack fans out to the right. */
export const PW = 720, PH = 440, XSTEP = 140
/** How far back a layer sits per page of distance from the focus. */
export const ZGAP = 160
export const TILT = 'rotateX(32deg) rotateY(-14deg)'
export const FADE_MIN = 0.15, FADE_STEP = 0.35, DIM_CABLE = 0.18
export const fade = (d: number) => Math.max(FADE_MIN, 1 - FADE_STEP * Math.abs(d))

export const PAD = 24, PAD_STEP = 30, HEAD = 34
export const TAB_W = 88, TAB_H = 20
export const SIDE_W = 280, SIDE_GAP = 140, BLOCK_HEAD = 30, BLOCK_GAP = 28, ITEM_GAP = 12
export const ZOOM_MIN = 0.3, ZOOM_MAX = 2.5
export const MARGIN = 60

/** Covers: the lifted position of the toggle, how far a cover floats per unit of lift, and how far a drag hides it. */
export const LIFT_ON = 0.85, LIFT_Z = 120, HIDE_DIST = 160
