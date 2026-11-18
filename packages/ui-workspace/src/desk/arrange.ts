// Where the Desk puts things: pure positions from the model and the saved layout. Callers left, callees right (B),
// runtimes fitted to their columns, snap to a grid, push-apart on drop, safe reading of the saved `layout.desk`.
import type { Column, DeskModel } from './model'

export type XY = { x: number; y: number }
export type DeskLayout = { snap: boolean; compact: boolean; runtimes: Record<string, XY>; pods: Record<string, Record<string, XY>> }
export type Sized = XY & { w: number; h: number }
export const GRID = 20

const HEAD = 40, PAD = 20, RANK_GAP = 60, STACK_GAP = 24
const snapTo = (v: number, on: boolean) => on ? Math.ceil(v / GRID) * GRID : v
const isXY = (v: any): v is XY => Number.isFinite(v?.x) && Number.isFinite(v?.y)
const xys = (raw: any): Record<string, XY> => Object.fromEntries(Object.entries(raw && typeof raw === 'object' ? raw : {}).filter(([, v]) => isXY(v)).map(([k, v]: [string, any]) => [k, { x: v.x, y: v.y }]))

/** Malformed or missing → the default. Only well-formed positions survive. */
export function readLayout(raw: unknown): DeskLayout {
  const r = raw && typeof raw === 'object' ? raw as any : {}
  const pods = r.pods && typeof r.pods === 'object' ? r.pods : {}
  return {
    snap: typeof r.snap === 'boolean' ? r.snap : true,
    compact: typeof r.compact === 'boolean' ? r.compact : false,
    runtimes: xys(r.runtimes),
    pods: Object.fromEntries(Object.entries(pods).map(([k, v]) => [k, xys(v)])),
  }
}

// Labels come from the jack key (`pod port:dir`): the op is the port's last `/` segment. ~7px a character (6 compact).
export const jackLabel = (key: string) => key.slice(key.indexOf(' ') + 1).replace(/:(in|out)$/, '').split('/').pop()!
/** A column's header height (compact: no implementation subtitle) and a jack row's: the one source for sizing, drawing and cords. */
export const colHead = (compact: boolean) => compact ? 28 : 44
export const rowH = (compact: boolean) => compact ? 20 : 26
/** Wide enough for the longest in label plus the longest out label; tall enough for the jack rows under the header. */
export function columnSize(c: Column, compact: boolean): { w: number; h: number } {
  const ch = compact ? 6 : 7, jh = rowH(compact)
  const widest = (ks: string[]) => Math.max(0, ...ks.map(k => jackLabel(k).length * ch))
  const w = Math.max(compact ? 150 : 190, widest(c.ins) + widest(c.outs) + 48)
  return { w, h: colHead(compact) + (Math.max(c.ins.length, c.outs.length) + 1) * jh }
}

/** Positions of runtimes, and pods in them, that are no longer placed (`lookup(d).placed`) dropped; hidden ones kept. */
export function prune(l: DeskLayout, placed: ReadonlyMap<string, ReadonlySet<string>>): DeskLayout {
  const runtimes = Object.fromEntries(Object.entries(l.runtimes).filter(([rt]) => placed.has(rt)))
  const pods = Object.fromEntries(Object.entries(l.pods).filter(([rt]) => placed.has(rt)).map(([rt, ps]) => [rt, Object.fromEntries(Object.entries(ps).filter(([p]) => placed.get(rt)!.has(p)))]))
  return { ...l, runtimes, pods }
}

/** Saved positions kept and clamped (those of hidden pods and runtimes too); new columns go right of the rightmost, runtimes by rank. */
export function arrange(m: DeskModel, l: DeskLayout) {
  const gap = l.compact ? 12 : 36
  const layout: DeskLayout = { ...l, runtimes: { ...l.runtimes }, pods: { ...l.pods } }
  const runtimes: Record<string, Sized> = {}, columns: Record<string, Record<string, Sized>> = {}
  for (const rt of m.runtimes) {
    const saved = l.pods[rt.id] ?? {}, at = layout.pods[rt.id] = { ...saved }, cols = columns[rt.id] = {} as Record<string, Sized>
    let edge = PAD - gap
    for (const c of rt.columns) if (saved[c.pod]) {
      const p = { x: Math.max(PAD, saved[c.pod]!.x), y: Math.max(HEAD, saved[c.pod]!.y) }
      at[c.pod] = p; cols[c.pod] = { ...p, ...columnSize(c, l.compact) }; edge = Math.max(edge, p.x + cols[c.pod]!.w)
    }
    for (const c of rt.columns) if (!saved[c.pod]) {
      const p = { x: snapTo(edge + gap, l.snap), y: snapTo(HEAD, l.snap) }
      at[c.pod] = p; cols[c.pod] = { ...p, ...columnSize(c, l.compact) }; edge = p.x + cols[c.pod]!.w
    }
  }
  const fitted = Object.fromEntries(m.runtimes.map(rt => {
    const cs = Object.values(columns[rt.id]!)
    return [rt.id, { w: snapTo(Math.max(160, ...cs.map(c => c.x + c.w)) + PAD, l.snap), h: snapTo(Math.max(HEAD + 40, ...cs.map(c => c.y + c.h)) + PAD, l.snap) }]   // an empty runtime: room for its header and hint
  }))
  const colX: number[] = [], colY: number[] = []
  const ranked = [...m.runtimes].sort((a, b) => (m.rank[a.id] ?? 0) - (m.rank[b.id] ?? 0))
  for (const { id } of ranked) { const d = m.rank[id] ?? 0; colX[d + 1] = Math.max(colX[d + 1] ?? 0, (colX[d] ?? PAD) + fitted[id]!.w + RANK_GAP) }
  const put = (id: string, p: XY) => { layout.runtimes[id] = p; runtimes[id] = { ...p, ...fitted[id]! } }
  for (const { id } of ranked) if (l.runtimes[id]) put(id, { x: Math.max(0, l.runtimes[id]!.x), y: Math.max(0, l.runtimes[id]!.y) })
  for (const { id } of ranked) if (!l.runtimes[id]) {
    const d = m.rank[id] ?? 0, f = fitted[id]!, x = snapTo(colX[d] ?? PAD, l.snap)
    let y = snapTo(colY[d] ?? PAD, l.snap), hit: Sized | undefined
    // a free slot: slide down past any runtime (saved or already placed) in the way
    while ((hit = Object.values(runtimes).find(o => x < o.x + o.w && o.x < x + f.w && y < o.y + o.h && o.y < y + f.h)))
      y = snapTo(hit.y + hit.h + STACK_GAP, l.snap)
    put(id, { x, y })
    colY[d] = y + f.h + STACK_GAP
  }
  return { layout, runtimes, columns }
}

/** New positions of the boxes `placed` pushed aside: each moves +x or +y, whichever is shorter, and cascades.
 *  A pushed box is also pushed clear of `placed`, which never moves. */
export function push(boxes: Record<string, Sized>, placed: string, snap: boolean): Record<string, XY> {
  const at: Record<string, Sized> = { ...boxes }, moved: Record<string, XY> = {}, queue = [placed]
  const away = (a: Sized, b: Sized): XY | undefined => {
    const dx = a.x + a.w + GRID - b.x, dy = a.y + a.h + GRID - b.y
    if (dx <= 0 || dy <= 0 || a.x >= b.x + b.w + GRID || a.y >= b.y + b.h + GRID) return
    return dx <= dy ? { x: snapTo(b.x + dx, snap), y: b.y } : { x: b.x, y: snapTo(b.y + dy, snap) }
  }
  for (let n = 0; queue.length && n < 1000; n++) { // a generous cap: it settles in a few rounds
    const cur = queue.shift()!
    for (const id of Object.keys(at)) {
      if (id === placed || id === cur) continue
      let p = away(at[cur]!, at[id]!)
      if (!p) continue
      p = away(at[placed]!, { ...at[id]!, ...p }) ?? p
      at[id] = { ...at[id]!, ...p }; moved[id] = p; queue.push(id)
    }
  }
  return moved
}

/** Positions cleared so `arrange` lays them out again; snap and compact kept. */
export const align = (_m: DeskModel, l: DeskLayout): DeskLayout => ({ ...l, runtimes: {}, pods: {} })

/** On: every position rounded to the grid. Off: positions unchanged. */
export function setSnap(l: DeskLayout, on: boolean): DeskLayout {
  const r = (p: XY) => on ? { x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID } : p
  const each = (o: Record<string, XY>) => Object.fromEntries(Object.entries(o).map(([k, p]) => [k, r(p)]))
  return { ...l, snap: on, runtimes: each(l.runtimes), pods: Object.fromEntries(Object.entries(l.pods).map(([k, v]) => [k, each(v)])) }
}
