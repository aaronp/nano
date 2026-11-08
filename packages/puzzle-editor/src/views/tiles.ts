// Puzzle-tile drawing, ported from puzzles/PuzzlePrototype.dc.html (shapeSegments, tilePath, iconFor, presetIcon).
import type { Shape } from '../model'

type Pt = [number, number]
export type Side = 'T' | 'R' | 'B' | 'L'
export type SideKind = 'flat' | 'knob' | 'hole'
type Edge = { p0: Pt; t: Pt; n: Pt; scale: number }

/** A tile is CELL square, drawn PAD in from the corner of a (CELL + 2 * PAD) square viewBox, so its knobs stay inside. */
export const CELL = 120, PAD = 40
const SIDES: Side[] = ['T', 'R', 'B', 'L']
const round1 = (n: number) => Math.round(n * 10) / 10
const fmt = (p: Pt) => `${round1(p[0])} ${round1(p[1])}`

const edge = (p0: Pt, t: Pt, n: Pt, scale = 1): Edge => ({ p0, t, n, scale })
const TILE_EDGES: Record<Side, Edge> = {
  T: edge([PAD, PAD], [1, 0], [0, -1]),
  R: edge([PAD + CELL, PAD], [0, 1], [1, 0]),
  B: edge([PAD + CELL, PAD + CELL], [-1, 0], [0, 1]),
  L: edge([PAD, PAD + CELL], [0, -1], [-1, 0]),
}
const edgeAt = (e: Edge, sign: number, u: number, v: number): Pt =>
  [e.p0[0] + (e.t[0] * u + e.n[0] * v * sign) * e.scale, e.p0[1] + (e.t[1] * u + e.n[1] * v * sign) * e.scale]
const edgeEnd = (e: Edge): Pt => [e.p0[0] + e.t[0] * CELL * e.scale, e.p0[1] + e.t[1] * CELL * e.scale]

function shapeSegments(e: Edge, sign: number, shape: Shape) {
  const at = (q: Pt) => fmt(edgeAt(e, sign, q[0], q[1]))
  return { start: edgeAt(e, sign, shape.start[0], shape.start[1]), body: shape.segs.map(s => `C ${at(s.c1)} ${at(s.c2)} ${at(s.p)}`).join(' ') }
}

/** The outline of a tile: each side flat, or a knob (out) or hole (in) of the side's shape. */
export function tilePath(sides: Record<Side, SideKind>, shapes: Partial<Record<Side, Shape>>): string {
  const parts = SIDES.map(side => {
    const e = TILE_EDGES[side], kind = sides[side], shape = shapes[side]
    if (kind === 'flat' || !shape) return `L ${fmt(edgeEnd(e))}`
    const s = shapeSegments(e, kind === 'knob' ? 1 : -1, shape)
    return `L ${fmt(s.start)} ${s.body} L ${fmt(edgeEnd(e))}`
  })
  return `M ${fmt(TILE_EDGES.T.p0)} ${parts.join(' ')} Z`
}

/** A small (30 x 26) block with the shape as its knob. */
export function iconFor(shape: Shape): string {
  const s = shapeSegments(edge([18, 1], [0, 1], [1, 0], 0.2), 1, shape)
  return `M 3 1 L 18 1 L ${fmt(s.start)} ${s.body} L 18 25 L 3 25 Z`
}

/** A small (40 x 30) bar with the shape as a bump on top. */
export function presetIcon(shape: Shape): string {
  const s = shapeSegments(edge([2, 26], [1, 0], [0, -1], 0.3), 1, shape)
  return `M 2 26 L ${fmt(s.start)} ${s.body} L 38 26 L 38 29 L 2 29 Z`
}
