// Pieces on a grid, and the connections they make. The board only publishes connections; it never applies them.
import { component, state } from '@composable/runes'
import { connectionsOf, pieceAt, type Cell, type Piece } from '../model/board'

/** The board: its pieces, and the connections derived from them. */
export const ConnectionBoard = component('composable.editor/connection-board', () => {
  const s = state({ pieces: [] as Piece[] })
  const free = (cell: Cell) => { if (pieceAt(s.pieces, cell)) throw new Error(`${cell.c},${cell.r} is taken`) }
  const on = (cell: Cell) => {
    const p = pieceAt(s.pieces, cell)
    if (!p) throw new Error(`nothing at ${cell.c},${cell.r}`)
    return p
  }
  return {
    get pieces() { return s.pieces },
    get connections() { return connectionsOf(s.pieces) },
    set: (pieces: Piece[]) => { s.pieces = pieces },
    place: (p: Piece) => { free(p.cell); s.pieces.push(p) },
    move: ({ from, to }: { from: Cell; to: Cell }) => { const p = on(from); free(to); p.cell = to },
    takeOff: (cell: Cell) => { const p = on(cell); s.pieces = s.pieces.filter(x => x !== p) },
    removeInstance: (id: string) => { s.pieces = s.pieces.filter(p => p.instance !== id) },
  }
})
