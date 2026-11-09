// The board's rule: pieces side by side in a row join when the left one's output fits the right one's input.
import { Ops, type Op, type Subscription } from '@pritzlaff/nano-core'

/** A grid position. */
export type Cell = { c: number; r: number }
/** One op of one instance, placed on the board. */
export type Piece = { instance: string; op: Op; cell: Cell }
/** A design-time connection: a core Subscription without its id. */
export type Connection = Omit<Subscription, 'id'>

/** Can `left` feed `right`? Same type (name included), or an input that takes anything: core's `Ops.fits`. */
export const joins = Ops.fits

const at = (cell: Cell) => `${cell.c},${cell.r}`

/** The connections the pieces make: one per neighbouring pair (c, c + 1 on a row) that joins. */
export function connectionsOf(pieces: readonly Piece[]): Connection[] {
  const by = new Map(pieces.map(p => [at(p.cell), p]))
  return pieces
    .map(l => [l, by.get(at({ c: l.cell.c + 1, r: l.cell.r }))] as const)
    .filter((pair): pair is readonly [Piece, Piece] => !!pair[1] && joins(pair[0].op, pair[1].op))
    .sort(([a], [b]) => a.cell.r - b.cell.r || a.cell.c - b.cell.c)
    .map(([l, r]) => ({ source: l.instance, op: Ops.key(l.op), listener: r.instance, target: Ops.key(r.op) }))
}

/** The piece on a cell, if any. */
export const pieceAt = (pieces: readonly Piece[], cell: Cell) => pieces.find(p => at(p.cell) === at(cell))
