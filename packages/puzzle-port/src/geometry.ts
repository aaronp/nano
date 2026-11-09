// Edge shapes and their SVG paths: presets, point editing, and drawing a shape along a tile, icon or editor edge.
import { CELL, PAD, SAMPLES, SIDES, U0, U1, UMAX, UMIN, VMAX, bug, fmt, type Pt, type Seg, type Shape, type Side } from './constants'

/** Clamps a point to the editable edge box. */
export function clampPt(p: Pt): Pt { return [Math.max(UMIN, Math.min(UMAX, p[0])), Math.max(0, Math.min(VMAX, p[1]))] }
const copyPt = (p: Pt): Pt => [p[0], p[1]]
const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const addPt = (a: Pt, d: Pt): Pt => [a[0] + d[0], a[1] + d[1]]
function line(a: Pt, b: Pt): Seg { return { c1: [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3], c2: [a[0] + 2 * (b[0] - a[0]) / 3, a[1] + 2 * (b[1] - a[1]) / 3], p: b } }
function polyline(points: Pt[]) { return { start: points[0]!, segs: points.slice(1).map((p, i) => line(points[i]!, p)) } }
type Raw = { preset?: string; start: Pt; segs: Seg[] }

/** Anchor k of a shape: the start, or the end of segment k-1. */
export function anchorOf(shape: Raw, k: number): Pt { return k === 0 ? shape.start : shape.segs[k - 1]!.p }

/** Splits segment si in two at its middle (de Casteljau). */
export function splitSegment(shape: Raw, si: number): Shape {
  const s = shape.segs[si]
  if (s === undefined) return bug('no segment ' + si)
  const p0 = anchorOf(shape, si)
  const a = mid(p0, s.c1); const b = mid(s.c1, s.c2); const c = mid(s.c2, s.p)
  const d = mid(a, b); const e = mid(b, c); const f = mid(d, e)
  const segs = shape.segs.slice(0, si).concat([{ c1: a, c2: d, p: f }, { c1: e, c2: c, p: s.p }]).concat(shape.segs.slice(si + 1))
  return { ...shape, preset: 'custom', segs }
}
/** Adds a centre point to a shape by splitting segment headIndex. */
export function centrePoint(shape: Raw, headIndex: number) { return splitSegment(shape, headIndex) }

/** The starting shapes. */
export const PRESETS: Record<string, Raw> = {
  jigsaw: centrePoint({ start: [51, 0], segs: [{ c1: [51, 9], c2: [38, 7], p: [38, 18] }, { c1: [38, 32], c2: [82, 32], p: [82, 18] }, { c1: [82, 7], c2: [69, 9], p: [69, 0] }] }, 1),
  slim: centrePoint({ start: [54, 0], segs: [{ c1: [54, 10], c2: [44, 10], p: [44, 22] }, { c1: [44, 36], c2: [76, 36], p: [76, 22] }, { c1: [76, 10], c2: [66, 10], p: [66, 0] }] }, 1),
  dome: { start: [38, 0], segs: [{ c1: [38, 16], c2: [46, 28], p: [60, 28] }, { c1: [74, 28], c2: [82, 16], p: [82, 0] }] },
  triangle: polyline([[40, 0], [60, 30], [80, 0]]),
  square: centrePoint(polyline([[42, 0], [42, 24], [78, 24], [78, 0]]), 1),
  house: polyline([[42, 0], [42, 18], [60, 32], [78, 18], [78, 0]]),
  double: { start: [38, 0], segs: [{ c1: [38, 24], c2: [58, 24], p: [60, 10] }, { c1: [62, 24], c2: [82, 24], p: [82, 0] }] },
  arrow: polyline([[46, 0], [46, 14], [36, 14], [60, 32], [84, 14], [74, 14], [74, 0]]),
  flat: polyline([[40, 0], [80, 0]])
}
export const PRESET_ORDER = ['jigsaw', 'slim', 'dome', 'triangle', 'square', 'house', 'double', 'arrow']
export const PRESET_LABELS: Record<string, string> = { jigsaw: 'Jigsaw', slim: 'Slim jigsaw', dome: 'Dome', triangle: 'Triangle', square: 'Square', house: 'House', double: 'Double', arrow: 'Arrow' }

/** A fresh copy of a preset. */
export function presetShape(id: string): Shape {
  const pr = PRESETS[id]
  if (pr === undefined) return bug('unknown preset ' + id)
  return { preset: id, start: copyPt(pr.start), segs: pr.segs.map(s => ({ c1: copyPt(s.c1), c2: copyPt(s.c2), p: copyPt(s.p) })) }
}
function profileToBezier(prof: number[]): Shape {
  const pts: Pt[] = ([[U0, 0]] as Pt[]).concat(SAMPLES.map((u, i): Pt => [u, prof[i]!])).concat([[U1, 0]])
  const segs: Seg[] = []
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = i === 0 ? pts[i]! : pts[i - 1]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = i + 2 < pts.length ? pts[i + 2]! : p2
    segs.push({ c1: clampPt([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]), c2: clampPt([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]), p: copyPt(p2) })
  }
  return { preset: 'custom', start: [U0, 0], segs }
}
/** Upgrades a saved shape: old brush profiles become curves; a preset whose point count changed is reset. */
export function migrateShape(shape: any): { shape: Shape; migrated: boolean } {
  if (Array.isArray(shape.segs) && Array.isArray(shape.start)) {
    const pr = PRESETS[shape.preset]
    if (pr !== undefined && pr.segs.length !== shape.segs.length) return { shape: presetShape(shape.preset), migrated: false }
    return { shape, migrated: false }
  }
  if (shape.preset === 'jigsaw') return { shape: presetShape('jigsaw'), migrated: true }
  if (Array.isArray(shape.profile)) return { shape: profileToBezier(shape.profile), migrated: true }
  return bug('unrecognised saved shape')
}

/** What a drag in the shape editor moves: an anchor, or a segment's first or second control point. */
export type Target = { kind: 'anchor' | 'c1' | 'c2'; index: number }
/** Moves a point; end anchors stay on the edge, and with `mirror` the opposite handle follows. */
export function movePoint(shape: Shape, target: Target, pt: Pt, mirror: boolean): Shape {
  const n = shape.segs.length
  if (target.kind === 'anchor') {
    const k = target.index
    if (k < 0 || k > n) return bug('anchor index ' + k)
    const old = anchorOf(shape, k)
    const raw = clampPt(pt)
    const next: Pt = k === 0 || k === n ? [raw[0], 0] : raw
    const d: Pt = [next[0] - old[0], next[1] - old[1]]
    return {
      ...shape, preset: 'custom', start: k === 0 ? next : shape.start,
      segs: shape.segs.map((s, i) => ({ c1: i === k ? clampPt(addPt(s.c1, d)) : s.c1, c2: i === k - 1 ? clampPt(addPt(s.c2, d)) : s.c2, p: i === k - 1 ? next : s.p }))
    }
  }
  const i = target.index
  if (i < 0 || i >= n) return bug('segment index ' + i)
  const np = clampPt(pt)
  if (target.kind === 'c1') {
    const a = anchorOf(shape, i)
    const mir = mirror && i >= 1 ? clampPt([2 * a[0] - np[0], 2 * a[1] - np[1]]) : null
    return { ...shape, preset: 'custom', segs: shape.segs.map((s, j) => (j === i ? { ...s, c1: np } : (mir !== null && j === i - 1 ? { ...s, c2: mir } : s))) }
  }
  const a = anchorOf(shape, i + 1)
  const mir = mirror && i + 1 <= n - 1 ? clampPt([2 * a[0] - np[0], 2 * a[1] - np[1]]) : null
  return { ...shape, preset: 'custom', segs: shape.segs.map((s, j) => (j === i ? { ...s, c2: np } : (mir !== null && j === i + 1 ? { ...s, c1: mir } : s))) }
}
/** Removes middle anchor k, merging its two segments. */
export function removeAnchor(shape: Shape, k: number): Shape {
  const n = shape.segs.length
  if (k < 1 || k > n - 1) return bug('cannot remove anchor ' + k)
  const merged = { c1: shape.segs[k - 1]!.c1, c2: shape.segs[k]!.c2, p: shape.segs[k]!.p }
  return { ...shape, preset: 'custom', segs: shape.segs.slice(0, k - 1).concat([merged]).concat(shape.segs.slice(k + 1)) }
}

/** An edge to draw a shape along: origin, tangent, normal and scale. */
export interface Edge { p0: Pt; t: Pt; n: Pt; scale: number }
/** Makes an edge. */
export function makeEdge(p0: Pt, t: Pt, n: Pt, scale: number): Edge { return { p0, t, n, scale } }
/** The point (u, v) on an edge; sign flips the normal (knob out, hole in). */
export function edgeAt(e: Edge, sign: number, u: number, v: number): Pt { return [e.p0[0] + (e.t[0] * u + e.n[0] * v * sign) * e.scale, e.p0[1] + (e.t[1] * u + e.n[1] * v * sign) * e.scale] }
function signOf(kind: string) {
  if (kind === 'knob') return 1
  if (kind === 'hole') return -1
  return bug('signOf on ' + kind)
}
/** A shape's start point and its 'C …' path body along an edge. */
export function shapeSegments(e: Edge, sign: number, shape: Shape, vScale: number) {
  if (!Array.isArray(shape.segs) || shape.segs.length === 0) return bug('shape has no segments')
  const at = (q: Pt) => fmt(edgeAt(e, sign, q[0], q[1] * vScale))
  const body = shape.segs.map(s => 'C ' + at(s.c1) + ' ' + at(s.c2) + ' ' + at(s.p)).join(' ')
  return { start: edgeAt(e, sign, shape.start[0], shape.start[1] * vScale), body }
}
/** A knob or hole as a closed path. */
export function knobClosed(e: Edge, kind: string, shape: Shape, vScale: number) {
  const s = shapeSegments(e, signOf(kind), shape, vScale)
  return 'M ' + fmt(s.start) + ' ' + s.body + ' Z'
}
/** The four edges of a tile, clockwise from the top. */
export const TILE_EDGES: Record<Side, Edge> = {
  T: makeEdge([PAD, PAD], [1, 0], [0, -1], 1),
  R: makeEdge([PAD + CELL, PAD], [0, 1], [1, 0], 1),
  B: makeEdge([PAD + CELL, PAD + CELL], [-1, 0], [0, 1], 1),
  L: makeEdge([PAD, PAD + CELL], [0, -1], [-1, 0], 1)
}
function edgeEnd(e: Edge): Pt { return [e.p0[0] + e.t[0] * CELL * e.scale, e.p0[1] + e.t[1] * CELL * e.scale] }
/** A tile's outline with each side flat, knob or hole. */
export function tilePath(sides: Record<Side, string>, shapes: Partial<Record<Side, Shape>>) {
  const parts = SIDES.map(side => {
    const e = TILE_EDGES[side]
    if (sides[side] === 'flat') return 'L ' + fmt(edgeEnd(e))
    const s = shapeSegments(e, signOf(sides[side]), shapes[side]!, 1)
    return 'L ' + fmt(s.start) + ' ' + s.body + ' L ' + fmt(edgeEnd(e))
  })
  return 'M ' + fmt(TILE_EDGES.T.p0) + ' ' + parts.join(' ') + ' Z'
}
/** The small half-tile icon of a shape (body and knob). */
export function iconFor(shape: Shape) {
  const e = makeEdge([18, 1], [0, 1], [1, 0], 0.2)
  const s = shapeSegments(e, 1, shape, 1)
  return { body: 'M 3 1 L 18 1 L ' + fmt(s.start) + ' ' + s.body + ' L 18 25 L 3 25 Z', knob: 'M ' + fmt(s.start) + ' ' + s.body + ' Z' }
}
/** The preset button's icon. */
export function presetIcon(shape: Shape) {
  const e = makeEdge([2, 26], [1, 0], [0, -1], 0.3)
  const s = shapeSegments(e, 1, shape, 1)
  return 'M 2 26 L ' + fmt(s.start) + ' ' + s.body + ' L 38 26 L 38 29 L 2 29 Z'
}
