// The prototype's drawing geometry: hanging cords, points along them, hit-testing jacks, and puzzle piece outlines.
import { HIT_R, PIECE_H, TAB_R } from './constants'
import type { Port } from './model'

type Pt = { x: number; y: number }
/** A cubic cord: its two ends and control points. */
export type Cord = { a: number[]; c1: number[]; c2: number[]; b: number[] }

/** Hanging patch cord geometry: both control points sit below the lower jack so the cable droops. */
export const cordGeo = (a: Pt, b: Pt): Cord => {
  const low = Math.max(a.y, b.y)
  const cy = Math.round(low + 92 + Math.abs(b.x - a.x) * 0.16)
  return { a: [a.x, a.y], c1: [a.x, cy], c2: [b.x, cy], b: [b.x, b.y] }
}
/** The cord as an SVG path. */
export const cordD = (geo: Cord) => 'M' + geo.a.map(Math.round).join(' ') + ' C' + [geo.c1, geo.c2, geo.b].map(p => p.map(Math.round).join(' ')).join(' ')
/** The point a fraction `f` along a cord. */
export const bezierAt = (geo: Cord, f: number): [number, number] => {
  const u = 1 - f
  const k = [u * u * u, 3 * u * u * f, 3 * u * f * f, f * f * f]
  const pts = [geo.a, geo.c1, geo.c2, geo.b]
  const at = (i: number) => pts.reduce((s, p, j) => s + p[i]! * k[j]!, 0)
  return [at(0), at(1)]
}
/** The point a fraction `f` along a polyline. */
export const polylineAt = (pts: number[][], f: number): number[] => {
  const lens = pts.slice(1).map((p, i) => Math.hypot(p[0]! - pts[i]![0]!, p[1]! - pts[i]![1]!))
  const total = lens.reduce((s, l) => s + l, 0)
  if (total === 0) return pts[0]!
  let d = f * total
  for (let i = 0; i < lens.length; i += 1) {
    if (d <= lens[i]! || i === lens.length - 1) {
      const r = lens[i] === 0 ? 0 : Math.min(1, d / lens[i]!)
      return [pts[i]![0]! + (pts[i + 1]![0]! - pts[i]![0]!) * r, pts[i]![1]! + (pts[i + 1]![1]! - pts[i]![1]!) * r]
    }
    d -= lens[i]!
  }
  throw new Error('bug: polylineAt fell off the end')
}

/** The jack nearest `pt` within HIT_R, other than `exclude`. */
export const nearestPort = (P: Record<string, Port>, keys: string[], pt: Pt, exclude: string | null) => {
  let best: string | null = null
  let bestD = HIT_R
  keys.forEach(k => {
    if (k === exclude) return
    const p = P[k]!
    const d = Math.hypot(p.x - pt.x, p.y - pt.y)
    if (d <= bestD) { best = k; bestD = d }
  })
  return best as string | null
}

/** A piece's outline: tabs on its right edge, and a notch on its left when something plugs into it. */
export const piecePath = (w: number, h: number, tabs: number[], notch: boolean) => {
  const r = TAB_R
  let d = 'M2 0 H' + (w - 2) + ' Q' + w + ' 0 ' + w + ' 2'
  tabs.forEach(ty => { d += ' V' + (ty - r) + ' a' + r + ' ' + r + ' 0 0 1 0 ' + (2 * r) })
  d += ' V' + (h - 2) + ' Q' + w + ' ' + h + ' ' + (w - 2) + ' ' + h + ' H2 Q0 ' + h + ' 0 ' + (h - 2)
  if (notch) d += ' V' + (PIECE_H / 2 + r) + ' a' + r + ' ' + r + ' 0 0 0 0 ' + (-2 * r)
  d += ' V2 Q0 0 2 0 Z'
  return d
}
/** A piece's width for its title and subtitle. */
export const textW = (title: string, sub: string) => Math.ceil(Math.max(title.length * 7.4, sub.length * 6.3) + 34)
