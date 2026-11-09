// The debounce view's model, from the debounce prototype: the switchback queue, the hatch and the batch buckets.
// Pure functions of (state, time); the element feeds them the real component's queue and flushes.
import type { Queued } from '../components/debounce'

/** Stage geometry and motion (px, slots, ms). Slot 0 sits on the hatch; higher slots run back along the switchback. */
export const G = {
  rows: 3, perRow: 18, sp: 54, xEnd: 1110, xStart: 192, rowY: [176, 106, 36],
  maxPos: 53, hidePos: -2.3,
  bucketTop: 290, bucketH: 270, pitch: 122, history: 8,
  enterSpeed: 0.07, flushSpeed: 0.06, hatchLeadMs: 180, settleMs: 260, slideMs: 480,
} as const

export type Reason = 'quiet' | 'max wait'
/** A batch dropping through the hatch: its values (with when each arrived), and when it lands. */
export type Flushing = { events: Queued[]; at: number; doneAt: number; reason: Reason }
export type Batch = { id: number; events: Queued[]; reason: Reason }

/** Why a queue flushed (or will): whichever deadline comes first. */
export const reasonFor = (q: Queued[], quiet: number, maxWait: number): Reason =>
  q.at(-1)!.at + quiet <= q[0]!.at + maxWait ? 'quiet' : 'max wait'

/** Where a queued value is: it slides in from the back of the queue to its slot. */
export const arrivalPos = (slot: number, at: number, now: number) => Math.max(slot, G.maxPos - (now - at) * G.enterSpeed)
/** How far a dropping batch has travelled towards the hatch. */
export const flushTravel = (f: Flushing, now: number) => Math.max(0, now - f.at - G.hatchLeadMs) * G.flushSpeed

/** A batch starts dropping now; it lands once its farthest value has passed the hatch. */
export function startFlush(events: Queued[], now: number, reason: Reason): Flushing {
  const farthest = Math.max(...events.map((e, i) => arrivalPos(i, e.at, now)))
  return { events, at: now, doneAt: now + G.hatchLeadMs + (farthest - G.hidePos) / G.flushSpeed + G.settleMs, reason }
}

/** A (fractional) queue position as stage coordinates along the switchback. */
export function slotXY(pos: number) {
  if (pos < 0) return { x: G.xEnd, y: G.rowY[0]! - pos * G.sp }
  const r = Math.min(G.rows - 1, Math.floor(pos / G.perRow)), i = pos - r * G.perRow
  const xAt = (row: number, idx: number) => (row % 2 === 0 ? G.xEnd - idx * G.sp : G.xStart + idx * G.sp)
  if (i <= G.perRow - 1) return { x: xAt(r, i), y: G.rowY[r]! }
  const frac = i - (G.perRow - 1)
  return { x: xAt(r, G.perRow - 1), y: G.rowY[r]! + (G.rowY[r + 1]! - G.rowY[r]!) * frac }
}

/** A value's colour, by its JSON type (the prototype coloured by event type). */
export function colorOf(v: unknown) {
  return typeof v === 'number' ? '#4C8DFF' : typeof v === 'string' ? '#FF9F1C' : v === null || typeof v === 'boolean' ? '#B48CFF' : '#2EC4A6'
}
export const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16)
  return 'rgba(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ', ' + a + ')'
}
export const label = (v: unknown, n: number) => { const s = typeof v === 'string' ? v : JSON.stringify(v) ?? String(v); return s.length > n ? s.slice(0, n - 1) + '…' : s }
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** A bucket's contents: cells stacked from the bottom, thinner the fuller it is. */
export function bucketView(events: Queued[]) {
  const n = events.length, inner = G.bucketH - 8, gap = n > 40 ? 0 : 2
  const h = n === 0 ? 0 : Math.max(1, Math.min(18, Math.floor((inner - gap * (n - 1)) / n)))
  const fill = n === 0 ? 0 : Math.min(inner, n * h + (n - 1) * gap)
  return {
    n, gap, solid: n > 0, countTop: G.bucketTop + G.bucketH - 4 - fill - 24,
    cells: events.map(e => ({ color: colorOf(e.value), bg: rgba(colorOf(e.value), 0.32), h, text: h >= 16 ? label(e.value, 8) : '' })),
  }
}
