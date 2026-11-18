// Jack layout: where an op's jacks sit on a panel's back or a rack module, each with the width of its slot (labels are
// cut to fit it). Shared by the views that draw jacks.
import { BLOCK_JACK_DY, JACK_W } from './constants'
import { portKey, type Jack, type Port } from './model'

type Box = { x: number; y: number; w: number; h: number }
const key = (owner: string, j: Jack) => portKey(owner, j.port + ':' + j.dir)
const port = (owner: string, j: Jack, x: number, y: number, slot: number, kind: Port['kind']): Port =>
  ({ key: key(owner, j), owner, op: j.op, port: j.port, x: Math.round(x), y, dir: j.dir, label: j.op.name, kind, slot })

/** A rack module's width: room for each jack's slot and for its name. */
export const moduleW = (id: string, ops: Jack[]) => Math.max(110, ops.length * JACK_W, Math.ceil(id.length * 7.4 + 24))

/** A panel's back: outs along the top, ins along the bottom. */
export const chassisJacks = (owner: string, ops: Jack[], c: Box): Port[] => (['out', 'in'] as const).flatMap(dir => {
  const row = ops.filter(o => o.dir === dir), slot = c.w / row.length
  return row.map((j, i) => port(owner, j, c.x + (i + 0.5) * slot, dir === 'out' ? c.y + 56 : c.y + c.h - 56, slot, 'chassis'))
})
/** A rack module's (or block's) jacks, in one row across it, each action's in and out side by side; `y` is its row. */
export const moduleJacks = (owner: string, ops: Jack[], m: Box, y: number, block: boolean): Port[] => {
  const row = ops, slot = m.w / row.length
  return row.map((j, i) => port(owner, j, m.x + (i + 0.5) * slot, block ? y + BLOCK_JACK_DY : y + 22, slot, block ? 'block' : 'module'))
}
/** A jack's label, cut to its slot. */
export const jackLabel = (p: Port) => { const n = Math.max(3, Math.floor((p.slot - 8) / 9.7)); return p.label.length > n ? p.label.slice(0, n - 1) + '…' : p.label }
