// The prototype's constants: geometry (back-face coordinates; x is mirrored vs the front), colours, timings, views.

/** Rack and piece geometry, relative to the pane's height H where the prototype had fixed rows below its 560px pane. */
export const RACK_TOP = 32          // the rack starts this far below the pane (592 - 560)
export const ROW_Y = 60             // first rack row below the pane (620 - 560)
export const ROW_STEP = 120         // between rack rows (740 - 620)
export const BLOCK_DY = -2          // a block's top vs its row (618 - 620)
export const BLOCK_JACK_DY = -14    // a block's jacks vs its row (606 - 620)
export const MOD_H = 92
export const BLOCK_H = 82
export const JACK_W = 56            // per-jack width of a rack module (the prototype's modules had two or three jacks)
export const PIECE_H = 40
export const ROW_H = 46
export const PUZ_Y0 = 40
export const TAB_R = 7
export const FORK_W = 64
export const HIT_R = 16
/** The pane's share of the stage when it eases back. */
export const SCALE = 0.9

/** Route colours, in the order routes get them: the prototype's four sample routes, then its extra colours. */
export const PALETTE = ['#7EE787', '#F5A524', '#4CC2FF', '#FF7AB6', '#D2A8FF', '#FFA657', '#79C0FF', '#F2CC60', '#56D4DD']
export const OK_COLOR = '#7EE787'
export const ERR_COLOR = '#FF7B72'

export const TRAVEL_MS = 900
export const FRAME_MS = 33
export const FLASH_MS = 320
/** ponytail: at most this many packets in flight; the oldest go first when a source floods. */
export const MAX_PACKETS = 60

/** Camera presets. */
export const VIEWS = {
  front: { ry: 0, rx: 0 },
  angled: { ry: -32, rx: -10 },
  back: { ry: 180, rx: -6 },
  under: { ry: 160, rx: 34 },
} as const
export type View = keyof typeof VIEWS

export const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap'

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const uniq = <A>(xs: A[]) => Array.from(new Set(xs))
export const short = (label: string, n: number) => (label.length > n ? label.slice(0, n - 1) + '…' : label)
