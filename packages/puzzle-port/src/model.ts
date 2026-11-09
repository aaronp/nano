// The model as pure functions: the empty model, loading and saving, action shapes, and how neighbours join.
import { DIRS, OPP, PAD, SIDES, STORE_KEY, bug, type Action, type Cell, type Model, type Ref, type Side, type TypeDef } from './constants'
import { migrateShape, presetShape } from './geometry'
import { refreshSha } from './sha'

function builtinTypes(): TypeDef[] {
  return [
    { id: 'string', name: 'string', kind: 'primitive', builtIn: true, shape: presetShape('jigsaw'), colour: '#5ED6B4', pattern: 'none' },
    { id: 'number', name: 'number', kind: 'primitive', builtIn: true, shape: presetShape('triangle'), colour: '#F5CF5B', pattern: 'none' },
    { id: 'boolean', name: 'boolean', kind: 'primitive', builtIn: true, shape: presetShape('dome'), colour: '#FF8FC0', pattern: 'none' }
  ]
}
/** A model with only the built-in types. */
export function emptyModel(): Model { return { types: builtinTypes(), elements: [], actions: [], placements: {}, nextId: 1 } }
function validateModel(m: any) {
  if (m === null || typeof m !== 'object') bug('model is not an object');
  (['types', 'elements', 'actions'] as const).forEach(k => { if (!Array.isArray(m[k])) bug('model.' + k + ' is not an array') })
  if (m.placements === null || typeof m.placements !== 'object') bug('model.placements is not an object')
  if (typeof m.nextId !== 'number') bug('model.nextId is not a number')
  const results = (m.types as TypeDef[]).map(t => migrateShape(t.shape))
  const migrated = results.filter(r => r.migrated).length
  const types = (m.types as TypeDef[]).map((t, i): TypeDef => ({ ...t, shape: results[i]!.shape, shapeSource: t.shapeSource === undefined ? 'custom' : t.shapeSource }))
  return { model: { ...m, types: refreshSha(types) } as Model, migrated }
}
/** Whether saving works, and what to say about it. */
export interface Storage { ok: boolean; text: string }
/** Loads the saved model (or an empty one), with the storage state and any notice. */
export function loadModel(): { model: Model; storage: Storage; notice: string } {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (raw === null) return { model: emptyModel(), storage: { ok: true, text: 'Saved in this browser' }, notice: '' }
    const v = validateModel(JSON.parse(raw))
    return { model: v.model, storage: { ok: true, text: 'Saved in this browser' }, notice: v.migrated > 0 ? 'Converted ' + v.migrated + ' brush-drawn shape(s) to editable curves.' : '' }
  } catch (err) {
    return { model: emptyModel(), storage: { ok: false, text: 'Not saving: ' + (err as Error).message }, notice: 'Your work will not be kept after a reload.' }
  }
}
/** Saves the model; the storage state to show afterwards. */
export function saveModel(model: Model): Storage {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(model))
    return { ok: true, text: 'Saved in this browser' }
  } catch (err) {
    return { ok: false, text: 'Not saving: ' + (err as Error).message }
  }
}

/** A type reference as text, e.g. `string[]`; '—' for none. */
export function typeLabel(ref: Ref | null, typeById: Record<string, TypeDef>) {
  if (ref === null) return '—'
  const t = typeById[ref.typeId]
  if (t === undefined) return bug('missing type ' + ref.typeId)
  return t.name + (ref.array ? '[]' : '')
}
const refEq = (a: Ref, b: Ref) => a.typeId === b.typeId && a.array === b.array
/** source (output only), sink (input only) or transform (both). */
export function roleOf(action: Action): 'source' | 'sink' | 'transform' {
  if (action.input !== null && action.output !== null) return 'transform'
  if (action.input !== null) return 'sink'
  if (action.output !== null) return 'source'
  return bug('action ' + action.name + ' has neither input nor output')
}
/** An action's tile: what each side is, and the type on each non-flat side. */
export interface TileShape { sides: Record<Side, 'flat' | 'knob' | 'hole'>; refs: Partial<Record<Side, Ref>> }
/** The tile shape of an action: input is a hole on L or T, output a knob on R or B. */
export function shapeOfAction(a: Action): TileShape {
  const sides: TileShape['sides'] = { T: 'flat', R: 'flat', B: 'flat', L: 'flat' }
  const refs: TileShape['refs'] = {}
  if (a.input !== null) {
    if (a.inputSide !== 'L' && a.inputSide !== 'T') bug('inputSide ' + a.inputSide)
    sides[a.inputSide] = 'hole'
    refs[a.inputSide] = a.input
  }
  if (a.output !== null) {
    if (a.outputSide !== 'R' && a.outputSide !== 'B') bug('outputSide ' + a.outputSide)
    sides[a.outputSide] = 'knob'
    refs[a.outputSide] = a.output
  }
  return { sides, refs }
}
/** A cell's key in an occupancy map. */
export function key(c: number, r: number) { return c + ',' + r }
/** Which action sits in each cell. */
export function occupancy(placements: Record<string, Cell>): Record<string, string> { return Object.fromEntries(Object.keys(placements).map(id => [key(placements[id]!.c, placements[id]!.r), id])) }
/** A copy of obj without key k. */
export function omit<T>(obj: Record<string, T>, k: string): Record<string, T> { return Object.fromEntries(Object.entries(obj).filter(([x]) => x !== k)) }
/** How a side joins its neighbour. */
export type Status = 'free' | 'blocked' | 'ok' | 'mismatch'
function joinStatus(mine: TileShape, theirs: TileShape | null, side: Side): Status {
  const kind = mine.sides[side]
  if (kind === 'flat') return bug('joinStatus on flat side')
  if (theirs === null) return 'free'
  const o = OPP[side]
  const want = kind === 'knob' ? 'hole' : 'knob'
  if (theirs.sides[o] !== want) return 'blocked'
  return refEq(mine.refs[side]!, theirs.refs[o]!) ? 'ok' : 'mismatch'
}
/** The status of each non-flat side of a shape placed at cell. */
export function statusesAt(shape: TileShape, cell: Cell, occ: Record<string, string>, shapes: Record<string, TileShape>): Partial<Record<Side, Status>> {
  return Object.fromEntries(SIDES.filter(s => shape.sides[s] !== 'flat').map(s => {
    const nid = occ[key(cell.c + DIRS[s][0], cell.r + DIRS[s][1])]
    return [s, joinStatus(shape, nid === undefined ? null : shapes[nid]!, s)]
  }))
}
/** Where a side's type label sits on a tile. */
export function labelFor(side: Side, text: string, colour: string) {
  if (side === 'R') return { left: PAD + 56, top: PAD + 94, width: 56, align: 'right', text, colour }
  if (side === 'B') return { left: PAD + 20, top: PAD + 106, width: 80, align: 'center', text, colour }
  if (side === 'L') return { left: PAD + 8, top: PAD + 94, width: 56, align: 'left', text, colour }
  return { left: PAD + 20, top: PAD + 36, width: 80, align: 'center', text, colour }
}
/** Everything that uses a type: actions, record fields and brands. */
export function usesOf(model: Model, typeId: string) {
  const inActions = model.actions.filter(a => (a.input !== null && a.input.typeId === typeId) || (a.output !== null && a.output.typeId === typeId)).map(a => 'action ' + a.name)
  const inFields = model.types.filter(t => t.kind === 'record' && t.fields!.some(f => f.typeId === typeId)).map(t => 'field of ' + t.name)
  const brands = model.types.filter(t => t.kind === 'alias' && t.aliasFor === typeId).map(t => 'brand ' + t.name)
  return inActions.concat(inFields, brands)
}
