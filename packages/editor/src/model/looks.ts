// Puzzle-piece looks: preset shapes, colours, and a look derived from a type's hash. Copied from puzzle-editor.
import { hashBytes, type TypeEntry } from './schema'

type Pt = [number, number]
type Seg = { c1: Pt; c2: Pt; p: Pt }
export type Look = {
  shape: { start: Pt; segs: Seg[] }
  colour: string
  pattern: 'none' | 'diagonal' | 'anti-diagonal' | 'vertical' | 'horizontal' | 'dots'
}
export type Shape = Look['shape']
export type Handle = { kind: 'anchor' | 'c1' | 'c2'; index: number }

const UMIN = 4, UMAX = 116, VMAX = 38
export const SWATCHES = ['#5ED6B4', '#F5CF5B', '#FF8FC0', '#9B8CFF', '#7CC7FF', '#FF9F7A', '#C5F27A', '#66D9E8', '#F2A7C8', '#D9D27A', '#E8833A', '#B0B8C8']
const PATTERNS: Look['pattern'][] = ['diagonal', 'anti-diagonal', 'vertical', 'horizontal', 'dots']

const clampPt = (p: Pt): Pt => [Math.max(UMIN, Math.min(UMAX, p[0])), Math.max(0, Math.min(VMAX, p[1]))]
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
/** The k-th anchor of a shape: its start, then each segment's end. */
export const anchorOf = (s: Shape, k: number): Pt => k === 0 ? s.start : s.segs[k - 1]!.p
const line = (a: Pt, b: Pt): Seg => ({ c1: [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], c2: [a[0] + 2 * (b[0] - a[0]) / 3, a[1] + 2 * (b[1] - a[1]) / 3], p: b })
const polyline = (pts: Pt[]): Shape => ({ start: pts[0]!, segs: pts.slice(1).map((p, i) => line(pts[i]!, p)) })

/** Add a point at the middle of segment `si`. A bad index returns the shape unchanged. */
export function splitSegment(shape: Shape, si: number): Shape {
  const s = shape.segs[si]
  if (!s) return shape
  const p0 = anchorOf(shape, si)
  const a = mid(p0, s.c1), b = mid(s.c1, s.c2), c = mid(s.c2, s.p)
  const d = mid(a, b), e = mid(b, c), f = mid(d, e)
  return { ...shape, segs: [...shape.segs.slice(0, si), { c1: a, c2: d, p: f }, { c1: e, c2: c, p: s.p }, ...shape.segs.slice(si + 1)] }
}

/** Remove an inner anchor (not an end). A bad index returns the shape unchanged. */
export function removeAnchor(shape: Shape, k: number): Shape {
  if (k < 1 || k > shape.segs.length - 1) return shape
  const merged: Seg = { c1: shape.segs[k - 1]!.c1, c2: shape.segs[k]!.c2, p: shape.segs[k]!.p }
  return { ...shape, segs: [...shape.segs.slice(0, k - 1), merged, ...shape.segs.slice(k + 1)] }
}

/** Move an anchor or control point; the two ends stay on the edge (y = 0). `mirror` mirrors the neighbouring control. */
export function movePoint(shape: Shape, target: Handle, pt: Pt, mirror = false): Shape {
  const n = shape.segs.length, i = target.index
  if (target.kind === 'anchor') {
    if (i < 0 || i > n) return shape
    const old = anchorOf(shape, i), raw = clampPt(pt)
    const next: Pt = i === 0 || i === n ? [raw[0], 0] : raw
    const d: Pt = [next[0] - old[0], next[1] - old[1]]
    const sh = (p: Pt): Pt => clampPt([p[0] + d[0], p[1] + d[1]])
    return {
      start: i === 0 ? next : shape.start,
      segs: shape.segs.map((s, j) => ({ c1: j === i ? sh(s.c1) : s.c1, c2: j === i - 1 ? sh(s.c2) : s.c2, p: j === i - 1 ? next : s.p })),
    }
  }
  if (i < 0 || i >= n) return shape
  const np = clampPt(pt)
  const refl = (a: Pt): Pt => clampPt([2 * a[0] - np[0], 2 * a[1] - np[1]])
  if (target.kind === 'c1') {
    const mir = mirror && i >= 1 ? refl(anchorOf(shape, i)) : null
    return { ...shape, segs: shape.segs.map((s, j) => j === i ? { ...s, c1: np } : mir && j === i - 1 ? { ...s, c2: mir } : s) }
  }
  const mir = mirror && i + 1 <= n - 1 ? refl(anchorOf(shape, i + 1)) : null
  return { ...shape, segs: shape.segs.map((s, j) => j === i ? { ...s, c2: np } : mir && j === i + 1 ? { ...s, c1: mir } : s) }
}

export const PRESETS: Record<'jigsaw' | 'slim' | 'dome' | 'triangle' | 'square' | 'house' | 'double' | 'arrow', Shape> = {
  jigsaw: splitSegment({ start: [51, 0], segs: [{ c1: [51, 9], c2: [38, 7], p: [38, 18] }, { c1: [38, 32], c2: [82, 32], p: [82, 18] }, { c1: [82, 7], c2: [69, 9], p: [69, 0] }] }, 1),
  slim: splitSegment({ start: [54, 0], segs: [{ c1: [54, 10], c2: [44, 10], p: [44, 22] }, { c1: [44, 36], c2: [76, 36], p: [76, 22] }, { c1: [76, 10], c2: [66, 10], p: [66, 0] }] }, 1),
  dome: { start: [38, 0], segs: [{ c1: [38, 16], c2: [46, 28], p: [60, 28] }, { c1: [74, 28], c2: [82, 16], p: [82, 0] }] },
  triangle: polyline([[40, 0], [60, 30], [80, 0]]),
  square: splitSegment(polyline([[42, 0], [42, 24], [78, 24], [78, 0]]), 1),
  house: polyline([[42, 0], [42, 18], [60, 32], [78, 18], [78, 0]]),
  double: { start: [38, 0], segs: [{ c1: [38, 24], c2: [58, 24], p: [60, 10] }, { c1: [62, 24], c2: [82, 24], p: [82, 0] }] },
  arrow: polyline([[46, 0], [46, 14], [36, 14], [60, 32], [84, 14], [74, 14], [74, 0]]),
}
export const PRESET_ORDER = ['jigsaw', 'slim', 'dome', 'triangle', 'square', 'house', 'double', 'arrow'] as const
export const PRESET_LABELS: Record<keyof typeof PRESETS, string> = { jigsaw: 'Jigsaw', slim: 'Slim jigsaw', dome: 'Dome', triangle: 'Triangle', square: 'Square', house: 'House', double: 'Double', arrow: 'Arrow' }

/** A fresh copy of a preset. */
export const presetShape = (id: keyof typeof PRESETS): Shape => structuredClone(PRESETS[id])

/** A look derived from 32 hash bytes alone: shape, colour and pattern. */
export function lookOf(bytes: number[]): Look {
  const b = (i: number) => (bytes[i % 32] ?? 0) / 255
  const n = 6 + b(0) * 5
  const h = Math.min(26, n + 7 + b(1) * 9)
  const y1 = 5 + b(2) * 6, y2 = 12 + b(3) * 8
  const top = Math.min(VMAX, y2 + 10 + b(4) * 8)
  const cx = 60 + (b(5) - 0.5) * 12, tilt = (b(6) - 0.5) * 10, sq = b(7) * 0.6
  const shape: Shape = {
    start: [cx - n, 0],
    segs: [
      { c1: [cx - n, y1], c2: [cx - h, y1 * 0.8], p: [cx - h, y2] },
      { c1: clampPt([cx - h + h * sq, top + tilt]), c2: clampPt([cx + h - h * sq, top - tilt]), p: [cx + h, y2] },
      { c1: [cx + h, y1 * 0.8], c2: [cx + n, y1], p: [cx + n, 0] },
    ],
  }
  return {
    shape: splitSegment(shape, 1),
    colour: `hsl(${Math.round(b(8) * 360)}, 62%, 68%)`,
    pattern: PATTERNS[Math.floor(b(9) * 4.999)]!,
  }
}

/** The look a type is drawn with: its hand-picked one, or the one derived from its hash. */
export const lookFor = (e: TypeEntry): Look => e.look ?? lookOf(hashBytes(e.type))

/** A piece's text on a swatch (dark on every swatch), and a piece with no look: data colours, the same in every theme. */
export const ON_SWATCH = '#0D0F13', NO_LOOK = '#3A4150'
