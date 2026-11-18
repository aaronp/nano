// The prototype's drawing geometry: hanging cords, points along them, hit-testing jacks.
import { HIT_R } from './constants'
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
