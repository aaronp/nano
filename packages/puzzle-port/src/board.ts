// What the board shows, as pure data: tiles, the drag's hover and eligible cells, connections, problems, the model JSON.
import { BAD, CELL, COLS, DIRS, OX, OY, PAD, ROLES, ROWS, SIDES, bug, byIdOf, type Action, type Model, type Side, type TypeDef } from './constants'
import { TILE_EDGES, knobClosed, tilePath } from './geometry'
import { key, labelFor, occupancy, omit, roleOf, shapeOfAction, statusesAt, typeLabel, type Status, type TileShape } from './model'

/** A drag in progress: the action, the pointer in canvas space, where it was grabbed, and whether it has moved. */
export interface Drag { id: string; x: number; y: number; gx: number; gy: number; moved: boolean }

/** The cell a drag would drop into, or null outside the grid. */
export function dropCell(d: Drag) {
  const c = Math.floor((d.x - d.gx + CELL / 2 - OX) / CELL)
  const r = Math.floor((d.y - d.gy + CELL / 2 - OY) / CELL)
  return c >= 0 && c < COLS && r >= 0 && r < ROWS ? { c, r } : null
}

/** One tile as drawn. */
export function tileView(action: Action, shape: TileShape, statuses: Partial<Record<Side, Status>>, left: number, top: number, opts: { selected: boolean; dragging: boolean }, typeById: Record<string, TypeDef>, elementName: string) {
  const role = ROLES[roleOf(action)]
  const visual = (side: Side) => { const t = typeById[shape.refs[side]!.typeId]; if (t === undefined) bug('missing type ' + shape.refs[side]!.typeId); return t }
  const empty = { d: '', fill: 'none', stroke: 'none', width: 0, pattern: 'none', inner: '' }
  const shapesBySide = Object.fromEntries(SIDES.filter(s => shape.sides[s] !== 'flat').map(s => [s, visual(s).shape]))
  const knobSide = SIDES.find(s => shape.sides[s] === 'knob')
  const holeSide = SIDES.find(s => shape.sides[s] === 'hole')
  const isBad = (st: Status | undefined) => st === 'mismatch' || st === 'blocked'
  const knob = knobSide === undefined ? empty : (() => {
    const t = visual(knobSide)
    const bad = isBad(statuses[knobSide])
    return {
      d: knobClosed(TILE_EDGES[knobSide], 'knob', t.shape, 1),
      fill: t.colour,
      stroke: bad ? BAD : role.stroke,
      width: bad ? 2.5 : 1.5,
      pattern: t.pattern === 'none' ? 'none' : 'url(#pat-' + t.pattern + ')',
      inner: shape.refs[knobSide]!.array ? knobClosed(TILE_EDGES[knobSide], 'knob', t.shape, 0.55) : ''
    }
  })()
  const hole = holeSide === undefined || statuses[holeSide] === 'ok' ? empty : (() => {
    const t = visual(holeSide)
    const bad = isBad(statuses[holeSide])
    return { d: knobClosed(TILE_EDGES[holeSide], 'hole', t.shape, 1), fill: t.colour, stroke: bad ? BAD : t.colour, width: 1.5, pattern: 'none', inner: '' }
  })()
  const labels = SIDES.filter(s => shape.sides[s] !== 'flat').map(s => {
    const bad = isBad(statuses[s])
    return labelFor(s, typeLabel(shape.refs[s]!, typeById) + (bad ? ' ✕' : ''), bad ? BAD : visual(s).colour)
  })
  return {
    id: action.id, name: action.name, element: elementName,
    left: left - PAD, top: top - PAD,
    d: tilePath(shape.sides, shapesBySide), fill: role.fill, stroke: role.stroke,
    knob, hole,
    selStroke: opts.selected ? '#E7E9EE' : 'none',
    nameTop: shape.sides.T === 'hole' ? PAD + 52 : PAD + 42,
    labels,
    opacity: opts.dragging ? 0.92 : 1,
    filter: opts.dragging ? 'drop-shadow(0 14px 22px rgba(0,0,0,0.55))' : 'none',
    z: opts.dragging ? 40 : (opts.selected ? 5 : 1),
    hit: opts.dragging ? 'none' : 'auto'
  }
}
/** A tile as drawn. */
export type TileView = ReturnType<typeof tileView>

/** Everything on the board for this model, drag and selection. */
export function boardView(m: Model, drag: Drag | null, selectedAction: string | null) {
  const typeById = byIdOf(m.types)
  const elementById = byIdOf(m.elements)
  const actionById = byIdOf(m.actions)
  const shapes = Object.fromEntries(m.actions.map(a => [a.id, shapeOfAction(a)]))
  const d = drag !== null && drag.moved ? drag : null
  const base = d !== null ? omit(m.placements, d.id) : m.placements
  const occ = occupancy(base)
  const placedIds = Object.keys(base)
  const statusById = Object.fromEntries(placedIds.map(id => [id, statusesAt(shapes[id]!, base[id]!, occ, shapes)]))
  const fullName = (a: Action) => elementById[a.elementId]!.name + '.' + a.name
  const connections = placedIds.flatMap(id => {
    const sh = shapes[id]!
    return SIDES.filter(side => sh.sides[side] === 'knob' && statusById[id]![side] === 'ok').map(side => {
      const nid = occ[key(base[id]!.c + DIRS[side][0], base[id]!.r + DIRS[side][1])]!
      return { from: fullName(actionById[id]!), to: fullName(actionById[nid]!), type: typeLabel(sh.refs[side]!, typeById) }
    })
  })
  const problems = placedIds.reduce((n, id) => n + SIDES.filter(side => {
    const st = statusById[id]![side]
    const kind = shapes[id]!.sides[side]
    return (kind === 'knob' && (st === 'mismatch' || st === 'blocked')) || (kind === 'hole' && st === 'blocked')
  }).length, 0)

  const elName = (a: Action) => elementById[a.elementId]!.name
  const tiles = placedIds.map(id => tileView(actionById[id]!, shapes[id]!, statusById[id]!, OX + base[id]!.c * CELL, OY + base[id]!.r * CELL, { selected: selectedAction === id, dragging: false }, typeById, elName(actionById[id]!)))
  const hoverCell = d !== null ? dropCell(d) : null
  const hoverFree = hoverCell !== null && occ[key(hoverCell.c, hoverCell.r)] === undefined
  const dragStatuses = d !== null && hoverCell !== null && hoverFree ? statusesAt(shapes[d.id]!, hoverCell, occ, shapes) : {}
  const vals = Object.values(dragStatuses)
  if (d !== null) {
    const a = actionById[d.id]!
    tiles.push(tileView(a, shapes[a.id]!, dragStatuses, d.x - d.gx, d.y - d.gy, { selected: true, dragging: true }, typeById, elName(a)))
  }
  const hover = hoverCell === null ? { show: false, left: 0, top: 0, colour: 'none' } : {
    show: true, left: OX + hoverCell.c * CELL, top: OY + hoverCell.r * CELL,
    colour: !hoverFree || vals.includes('mismatch') || vals.includes('blocked') ? BAD : (vals.includes('ok') ? '#7CE3A1' : '#E7E9EE')
  }
  const eligible: { left: number; top: number }[] = []
  if (d !== null) {
    const ds = shapes[d.id]!
    for (let r = 0; r < ROWS; r += 1) {
      for (let c = 0; c < COLS; c += 1) {
        if (occ[key(c, r)] !== undefined) continue
        const v = Object.values(statusesAt(ds, { c, r }, occ, shapes))
        if (v.includes('ok') && !v.includes('mismatch') && !v.includes('blocked')) eligible.push({ left: OX + c * CELL, top: OY + r * CELL })
      }
    }
  }
  const modelOut = {
    types: m.types.map(t => ({ id: t.id, name: t.name, kind: t.kind, ...(t.kind === 'record' ? { fields: t.fields!.map(fd => ({ name: fd.name, type: typeById[fd.typeId]!.name, array: fd.array })) } : {}), ...(t.kind === 'alias' ? { aliasFor: typeById[t.aliasFor!]!.name } : {}), display: { colour: t.colour, pattern: t.pattern, shape: t.shape.preset } })),
    elements: m.elements.map(el => ({ name: el.name, actions: m.actions.filter(a => a.elementId === el.id).map(a => ({ name: a.name, input: a.input === null ? null : typeLabel(a.input, typeById), output: a.output === null ? null : typeLabel(a.output, typeById) })) })),
    connections
  }
  return {
    tiles, eligible, hover,
    emptyBoard: placedIds.length === 0 && d === null,
    summary: placedIds.length + ' placed · ' + connections.length + ' connection' + (connections.length === 1 ? '' : 's') + ' · ' + problems + ' problem' + (problems === 1 ? '' : 's'),
    modelJson: JSON.stringify(modelOut, null, 2)
  }
}
