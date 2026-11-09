// The board: a grid of pieces drawn with their types' looks. Pick an op in the list, then click a cell to place it.
import { html, svg } from 'lit'
import { Ops } from '@composable/core'
import type { Entry, Selection } from '../components/component-list'
import { ConnectionBoard as B } from '../components/connection-board'
import { pieceAt, type Cell, type Connection, type Piece } from '../model/board'
import type { TypeEntry } from '../model'
import { base } from './styles'
import { CELL, PAD, tilePath } from './tiles'
import { lookOfSchema } from './types'
import { ModelElement } from './view'

const SIZE = 84

/** Shows a connection-board model. `components` and `selected` come from the component list. */
export class ConnectionBoardEl extends ModelElement {
  static styles = [base]
  static properties = { ...ModelElement.properties, types: { attribute: false }, components: { attribute: false }, selected: { attribute: false }, picked: { state: true } }
  declare types: TypeEntry[]
  declare components: Entry[]
  declare selected: Selection
  declare picked?: Cell

  render() {
    const pieces = this.read<Piece[]>(B.ops.pieces) ?? [], links = this.read<Connection[]>(B.ops.connections) ?? []
    const cols = Math.max(6, ...pieces.map(p => p.cell.c + 2)), rows = Math.max(3, ...pieces.map(p => p.cell.r + 2))
    const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ({ c, r }))).flat()
    const focused = this.picked && pieceAt(pieces, this.picked)
    return html`<div class="col">
      <div style="display:grid;grid-template-columns:repeat(${cols},${SIZE}px);gap:0;background:#0D0F13;border:1px solid #2A303C;border-radius:8px;padding:8px;width:max-content">
        ${cells.map(cell => this.cell(cell, pieceAt(pieces, cell)))}
      </div>
      ${focused ? html`<div class="row"><span class="mono">${focused.instance} · ${focused.op.name}</span>
        <button @click=${async () => { await this.act(B.ops.takeOff, focused.cell); this.picked = undefined }}>Take off</button></div>` : ''}
      <div class="col mono">${links.map(l => html`<div class="connection">${l.source} · ${l.op} → ${l.listener} · ${l.target}</div>`)}</div>
      ${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}
    </div>`
  }

  cell(cell: Cell, piece?: Piece) {
    const click = () => (piece ? (this.picked = cell) : this.place(cell))
    const box = `width:${SIZE}px;height:${SIZE}px;cursor:pointer;outline:${piece && this.picked?.c === cell.c && this.picked?.r === cell.r ? '1px solid #6FA8FF' : '1px dashed #1E232D'}`
    return html`<div data-cell="${cell.c},${cell.r}" style=${box} @click=${click}>${piece ? this.tile(piece) : ''}</div>`
  }

  tile(p: Piece) {
    const types = this.types ?? [], inLook = p.op.input && lookOfSchema(types, p.op.input), outLook = p.op.output && lookOfSchema(types, p.op.output)
    const d = tilePath({ T: 'flat', B: 'flat', L: inLook ? 'hole' : 'flat', R: outLook ? 'knob' : 'flat' }, { L: inLook?.shape, R: outLook?.shape })
    const v = CELL + 2 * PAD
    return svg`<svg width=${SIZE} height=${SIZE} viewBox="0 0 ${v} ${v}">
      <path d=${d} fill=${(outLook ?? inLook)?.colour ?? '#3A4150'} stroke="#0D0F13" stroke-width="3"></path>
      <text x=${v / 2} y=${v / 2} text-anchor="middle" font-size="18" font-family="Inter, sans-serif" fill="#0D0F13">${p.op.name}</text>
      <text x=${v / 2} y=${v / 2 + 22} text-anchor="middle" font-size="14" font-family="Inter, sans-serif" fill="#0D0F13">${p.instance}</text></svg>`
  }

  place(cell: Cell) {
    const s = this.selected, op = s?.op && this.components?.find(c => c.id === s.component)?.ops.find(o => Ops.key(o) === s.op)
    if (s?.component && op) void this.act(B.ops.place, { instance: s.component, op, cell })
  }
}
