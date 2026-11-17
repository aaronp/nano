// The prototype's buildPuzzle over the model: each route as chains of interlocking pieces, with forks where one
// output feeds several inputs, per-wire packet paths, and a readable chain string per route.
import { FORK_W, PIECE_H, PUZ_Y0, ROW_H } from './constants'
import { textW } from './geometry'
import { ownerLabel, portName, type Model, type Wire } from './model'

/** One piece: an operator (a rack module), a panel's port, a store (a rack block's port), or a fork. */
export type Piece = {
  kind: 'op' | 'port' | 'store' | 'fork'; title: string; sub: string; label: string; moduleId: string | null; owner: string | null
  anchors: string[]; route: string; x: number; y: number; w: number; h: number; tabs: number[]; notch: boolean; inWire: string | null
}
/** A packet's path for a wire: along the pieces, or on the plate (a leader). */
export type Seg = { layer: 'piece' | 'plate'; pts: number[][] }
type Node = { kind: 'src' | 'sink'; key: string } | { kind: 'module'; id: string }

/** A module's primary input is its first in jack with a cord; its other wired inputs are secondary (leaders). */
export const primaryIns = (m: Model) => {
  const out = new Map<string, string>()
  Object.values(m.P).forEach(p => { if (p.kind === 'module' && p.dir === 'in' && !out.has(p.owner) && m.wires.some(w => w.to === p.key)) out.set(p.owner, p.key) })
  return out
}

/** Derives the pieces, packet paths and chain strings from the model. */
export function buildPuzzle(m: Model) {
  const P = m.P
  const primary = primaryIns(m)
  const roleOf = (key: string) => (P[key]!.kind !== 'module' ? 'sink' : primary.get(P[key]!.owner) === key ? 'primary' : 'secondary')
  const pieces: Piece[] = []
  const descs: Record<string, string> = {}
  const segs: Record<string, Seg> = {}
  const centres: Record<string, number[]> = {}
  let rowCursor = 0
  m.routes.forEach(r => {
    const rw = m.wires.filter(w => w.route === r.id)
    const outsOf = (node: Node) => (node.kind === 'module' ? rw.filter(w => P[w.from]!.owner === node.id) : rw.filter(w => w.from === node.key))
    const targetOf = (w: Wire): Node => (P[w.to]!.kind === 'module' ? { kind: 'module', id: P[w.to]!.owner } : { kind: 'sink', key: w.to })
    const srcRoots: Node[] = [...new Set(rw.filter(w => P[w.from]!.kind !== 'module' && roleOf(w.to) !== 'secondary').map(w => w.from))]
      .map(key => ({ kind: 'src', key }))
    const modRoots: Node[] = [...new Set(rw.filter(w => P[w.from]!.kind === 'module').map(w => P[w.from]!.owner))]
      .filter(id => !primary.has(id))
      .map(id => ({ kind: 'module', id }))
    const seen = new Set<string>()

    const infoOf = (node: Node) => {
      if (node.kind === 'module') {
        const secondary = m.wires.filter(w => P[w.to]!.owner === node.id && roleOf(w.to) === 'secondary')
        const notes = secondary.map(w => '+ ' + portName(m, w.from))
        const item = m.rack.find(x => x.id === node.id)!
        return { kind: 'op' as const, title: item.title, sub: notes.length ? notes.join('  ') : item.sub, label: item.title, moduleId: node.id, owner: node.id, anchors: secondary.map(w => w.from) }
      }
      const p = P[node.key]!
      return {
        kind: p.kind === 'block' ? 'store' as const : 'port' as const, title: ownerLabel(m, p.owner),
        sub: (node.kind === 'src' ? 'on: ' : 'do: ') + p.label, label: portName(m, node.key), moduleId: null, owner: p.owner, anchors: [node.key],
      }
    }

    const walk = (node: Node, x: number, row: number, inWire: string | null, notch: boolean): { rows: number; desc: string; cx: number; cy: number } => {
      if (node.kind === 'module') {
        // reached again (a cycle, or two cords into one input): point at the piece already laid out
        if (seen.has(node.id)) { const c = centres[node.id] ?? [x, PUZ_Y0 + row * ROW_H + PIECE_H / 2]; return { rows: 0, desc: ownerLabel(m, node.id) + ' ↺', cx: c[0]!, cy: c[1]! } }
        seen.add(node.id)
      }
      const info = infoOf(node)
      const nexts = node.kind === 'sink' ? [] : outsOf(node).filter(w => roleOf(w.to) !== 'secondary')
      const w = textW(info.title, info.sub)
      const y = PUZ_Y0 + row * ROW_H
      const cx = x + w / 2
      const cy = y + PIECE_H / 2
      pieces.push({ ...info, route: r.id, x, y, w, h: PIECE_H, tabs: nexts.length ? [PIECE_H / 2] : [], notch, inWire })
      if (info.moduleId) centres[info.moduleId] = [cx, cy]
      if (nexts.length === 0) return { rows: 1, desc: info.label, cx, cy }
      if (nexts.length === 1) {
        const res = walk(targetOf(nexts[0]!), x + w, row, nexts[0]!.id, true)
        segs[nexts[0]!.id] = { layer: 'piece', pts: [[cx, cy], [res.cx, res.cy]] }
        return { rows: Math.max(1, res.rows), desc: info.label + ' → ' + res.desc, cx, cy }
      }
      const fx = x + w
      const fcx = fx + FORK_W / 2
      let cursor = row
      const tabRows: number[] = []
      const parts: string[] = []
      nexts.forEach(nw => {
        tabRows.push(cursor)
        const res = walk(targetOf(nw), fx + FORK_W, cursor, nw.id, true)
        segs[nw.id] = { layer: 'piece', pts: [[cx, cy], [fcx, cy], [fcx, res.cy], [res.cx, res.cy]] }
        parts.push(res.desc)
        cursor += Math.max(1, res.rows)
      })
      const h = (tabRows[tabRows.length - 1]! - row) * ROW_H + PIECE_H
      pieces.push({
        kind: 'fork', title: 'fork', sub: '×' + nexts.length, label: 'fork', moduleId: null, owner: null, anchors: [],
        route: r.id, x: fx, y, w: FORK_W, h, tabs: tabRows.map(t => (t - row) * ROW_H + PIECE_H / 2), notch: true, inWire: null,
      })
      return { rows: cursor - row, desc: info.label + ' → fork(' + parts.join(' | ') + ')', cx, cy }
    }

    const routeDescs: string[] = []
    let used = 0
    srcRoots.concat(modRoots).forEach(root => {
      const res = walk(root, 40, rowCursor + used, null, false)
      routeDescs.push(res.desc)
      used += Math.max(1, res.rows)
    })
    descs[r.id] = routeDescs.join('   ·   ')
    rowCursor += used + 0.6
  })
  m.wires.filter(w => !segs[w.id]).forEach(w => {
    const c = centres[P[w.to]!.owner]
    if (c && roleOf(w.to) === 'secondary') segs[w.id] = { layer: 'plate', pts: [[P[w.from]!.x, P[w.from]!.y], c] }
  })
  return { pieces, descs, segs }
}

/** A piece's colours: ports and stores outlined in the route colour, operators and forks filled with it. */
export const pieceColors = (kind: Piece['kind'], color: string) => {
  if (kind === 'port') return { fill: '#1B212A', stroke: color, titleColor: '#E6EDF3', subColor: '#A3AEBC' }
  if (kind === 'store') return { fill: '#2A303B', stroke: color, titleColor: '#E6EDF3', subColor: '#A3AEBC' }
  return { fill: color, stroke: 'rgba(0,0,0,0.45)', titleColor: '#12161C', subColor: '#2A2F37' }
}
