/**
 * The Ring's pure parts: each runtime a cluster on an outer ring (one runtime: centred), its own pods around it, the
 * pods placed in several runtimes near the centre; where a message's dot is; and whether the views show the past.
 *
 *   const l = ringLayout(app.deployment(), { size: 600 })
 *   ringDot(l, app.deployment(), message, 0.5)   // halfway from sender to receiver
 */
import type { AppDeployment } from '@pritzlaff/nano-core'
import type { Message } from './entry.ts'

type XY = { x: number; y: number }
export type RingLayout = {
  runtimes: { id: string; x: number; y: number; r: number }[]
  /** `runtime` null: shared, placed in two or more runtimes. */
  pods: { pod: string; runtime: string | null; x: number; y: number }[]
}

const placedIn = (d: AppDeployment, pod: string) => Object.keys(d.runtimes).filter(r => d.runtimes[r]!.pods.includes(pod))
/** `n` points evenly on a circle around `o`, from the top; one point is `o` itself. */
const around = (o: XY & { r: number }, n: number): XY[] =>
  Array.from({ length: n }, (_, i) => n === 1 ? { x: o.x, y: o.y } : { x: o.x + o.r * Math.cos(2 * Math.PI * i / n - Math.PI / 2), y: o.y + o.r * Math.sin(2 * Math.PI * i / n - Math.PI / 2) })

/** `show(pod, implementation)` picks the pods drawn (default: all); every runtime is drawn. A pod placed nowhere is not. */
export function ringLayout(d: AppDeployment, opts: { size: number; show?: (pod: string, impl: string) => boolean }): RingLayout {
  const { size } = opts, c = size / 2, ids = Object.keys(d.runtimes), one = ids.length === 1
  const ring = one ? 0 : 0.36 * size, r = one ? 0.38 * size : Math.min(0.12 * size, ring * Math.sin(Math.PI / ids.length) * 0.9)
  const runtimes = around({ x: c, y: c, r: ring }, ids.length).map((p, i) => ({ id: ids[i]!, ...p, r }))
  const shown = (p: string) => !opts.show || opts.show(p, d.pods[p]!.implementation)
  const own = runtimes.flatMap(rt => {
    const ps = d.runtimes[rt.id]!.pods.filter(p => d.pods[p] && placedIn(d, p).length === 1 && shown(p))
    return around(rt, ps.length).map((xy, i) => ({ pod: ps[i]!, runtime: rt.id, ...xy }))
  })
  const shared = Object.keys(d.pods).filter(p => placedIn(d, p).length > 1 && shown(p))
  return { runtimes, pods: [...own, ...around({ x: c, y: c, r: 0.1 * size }, shared.length).map((xy, i) => ({ pod: shared[i]!, runtime: null, ...xy }))] }
}

/** A pod's place: its own, else (hidden) the centre of `runtime` if that places it, else of the first runtime that does. */
function placeOf(l: RingLayout, d: AppDeployment, pod: string, runtime: string): XY | undefined {
  const own = l.pods.find(p => p.pod === pod)
  if (own) return own
  const places = placedIn(d, pod), rt = places.includes(runtime) ? runtime : places[0]
  return l.runtimes.find(r => r.id === rt)
}

/** The dot of `m` at `progress` (0..1) from sender to receiver; undefined for the host or a pod not placed. */
export function ringDot(l: RingLayout, d: AppDeployment, m: Message, progress: number): XY | undefined {
  const a = placeOf(l, d, m.sent.from, m.sent.runtime), b = placeOf(l, d, m.sent.to, m.sent.runtime)
  return a && b ? { x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress } : undefined
}

/** What the views show: the live app, the past (an app rebuilt to the cursor) or, the history too long to rebuild, the live app. */
export function ringSource(mode: 'live' | 'paused' | 'playing', atNewest: boolean, rebuildable: boolean): 'live' | 'past' | 'too-long' {
  return mode === 'live' || atNewest ? 'live' : rebuildable ? 'past' : 'too-long'
}
