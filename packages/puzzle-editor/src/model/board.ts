/**
 * The designer's model, all pure:
 *   - the palette: components and their ops (pieces) from the instances present, with each type identified by SAID;
 *   - the document: `{ intents, layout }`. The intents (from @composable/connections) are the truth; `layout` only
 *     says where each workflow's first piece sits. A workflow is a contiguous row of pieces on the board;
 *   - edits (place, take, move, pin, toggle, addConnection, remove) return a new document;
 *   - a type's look (hue, knob, pattern), derived from its SAID.
 */
import { canonicalType, roleOf, typeHash, type ComponentId, type Instance, type Op, type Role } from '@composable/sdk'
import type { Connection, InstanceSel, Intent, Workflow } from '@composable/connections'
import type { TSchema } from 'typebox'

// ---------------------------------------------------------------- palette

/** A type as the designer shows it: its SAID, a readable name, and whether it takes anything (Unknown). */
export type TypeInfo = { hash: string; name: string; any: boolean }
/** One op of a component: a piece. An input is a hole on the left, an output a knob on the right. */
export type PieceSpec = { op: string; label: string; description?: string; role: Role; input?: TypeInfo; output?: TypeInfo }
export type PaletteEntry = { key: string; component: ComponentId; instances: string[]; pieces: PieceSpec[] }

const short = (name: string) => name.split('/').pop()!
export const componentKey = (id: ComponentId) => `${id.author}/${id.id}`

/** A readable name for a type: its `$id` if named, else a short structural label. */
export function typeName(schema: TSchema): string {
  const s = schema as Record<string, any>
  if (typeof s.$id === 'string') return short(s.$id.replace(/\./g, '/'))
  const form = canonicalType(schema) as Record<string, any>
  if (Object.keys(form).length === 0) return 'any'
  if (form.type === 'object') return `{ ${Object.keys(form.properties ?? {}).join(', ')} }`
  if (form.type === 'array') return `${s.items ? typeName(s.items) : 'any'}[]`
  if (form.anyOf) return (s.anyOf as TSchema[]).map(typeName).join(' | ')
  // Constraints are part of a type: show them, so `number 0..100` and `number` are visibly different.
  const lo = form.minimum ?? form.exclusiveMinimum ?? form.minLength, hi = form.maximum ?? form.exclusiveMaximum ?? form.maxLength
  const range = lo !== undefined || hi !== undefined ? ` ${lo ?? ''}..${hi ?? ''}` : ''
  const more = Object.keys(form).filter(k => !['type', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength'].includes(k))
  return `${String(form.type ?? 'value')}${range}${more.length ? ` (${more.join(', ')})` : ''}`
}

export const typeInfo = (schema: TSchema): TypeInfo => ({
  hash: typeHash(schema), name: typeName(schema), any: Object.keys(canonicalType(schema) as object).length === 0,
})

const pieceOf = (op: Op): PieceSpec => ({
  op: op.name, label: short(op.name), description: op.description, role: roleOf(op),
  ...(op.input ? { input: typeInfo(op.input) } : {}), ...(op.output ? { output: typeInfo(op.output) } : {}),
})

/** The components present, each with its instances and pieces, sorted by key. */
export function palette(instances: readonly Instance[]): PaletteEntry[] {
  const by = new Map<string, PaletteEntry>()
  for (const i of instances) {
    if (!i.manifest.ops.length) continue // nothing to connect (e.g. a policy or a party)
    const key = componentKey(i.manifest.id)
    const e = by.get(key) ?? { key, component: i.manifest.id, instances: [], pieces: i.manifest.ops.map(pieceOf) }
    e.instances.push(i.id)
    by.set(key, e)
  }
  return [...by.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** Can `output` feed `input`? The same SAID, or an input that takes anything. */
export const joins = (output?: TypeInfo, input?: TypeInfo) => !!output && !!input && (input.any || output.hash === input.hash)

/** Which pieces in the palette `piece` could join, either side: what to highlight while dragging it. */
export function partners(entries: readonly PaletteEntry[], piece: PieceSpec) {
  const out: { key: string; op: string; side: 'before' | 'after' }[] = []
  for (const e of entries) for (const p of e.pieces) {
    if (joins(p.output, piece.input)) out.push({ key: e.key, op: p.op, side: 'before' })
    if (joins(piece.output, p.input)) out.push({ key: e.key, op: p.op, side: 'after' })
  }
  return out
}

// ---------------------------------------------------------------- document

export type Cell = { c: number; r: number }
export type Step = Workflow['steps'][number]
export type Connections = { intents: Intent[]; layout: Record<string, Cell> }
export type BoardPiece = { workflow: string; index: number; cell: Cell; step: Step }

export const emptyConnections = (): Connections => ({ intents: [], layout: {} })
export const workflows = (doc: Connections) => doc.intents.filter((i): i is Workflow => i.kind === 'workflow')
export const connections = (doc: Connections) => doc.intents.filter((i): i is Connection => i.kind === 'connection')

/** Where each workflow starts; ones without a layout (e.g. loaded from bare intents) go on rows of their own. */
export function cellsOf(doc: Connections): Record<string, Cell> {
  const out = { ...doc.layout }
  let r = Math.max(-1, ...Object.values(out).map(c => c.r))
  for (const w of workflows(doc)) if (!out[w.id]) out[w.id] = { c: 0, r: ++r }
  return out
}

/** Every piece on the board, from the workflows and their layout. */
export function board(doc: Connections): BoardPiece[] {
  const cells = cellsOf(doc)
  return workflows(doc).flatMap(w => w.steps.map((step, index) =>
    ({ workflow: w.id, index, cell: { c: cells[w.id].c + index, r: cells[w.id].r }, step })))
}

const at = (doc: Connections, cell: Cell) => board(doc).find(p => p.cell.c === cell.c && p.cell.r === cell.r)
const replace = (doc: Connections, id: string, next: Intent[]): Intent[] =>
  doc.intents.flatMap(i => i.id === id ? next : [i])

/**
 * Put a piece in an empty cell. Next to the end of a workflow it joins it, next to the start it joins that one,
 * between two it merges them; otherwise it starts a workflow `newId`. Joins are made whatever the types: `plan`
 * reports a mismatch.
 */
export function place(doc: Connections, step: Step, cell: Cell, newId: string): Connections {
  if (at(doc, cell)) return doc
  const cells = cellsOf(doc)
  const left = at(doc, { c: cell.c - 1, r: cell.r }), right = at(doc, { c: cell.c + 1, r: cell.r })
  const wf = (id: string) => workflows(doc).find(w => w.id === id)!
  const endsLeft = left && left.index === wf(left.workflow).steps.length - 1 ? wf(left.workflow) : undefined
  const startsRight = right && right.index === 0 ? wf(right.workflow) : undefined
  const layout = { ...cells }
  if (endsLeft && startsRight) {
    delete layout[startsRight.id]
    const merged: Workflow = { ...endsLeft, steps: [...endsLeft.steps, step, ...startsRight.steps] }
    return { intents: replace({ ...doc, intents: replace(doc, endsLeft.id, [merged]) }, startsRight.id, []), layout }
  }
  if (endsLeft) return { intents: replace(doc, endsLeft.id, [{ ...endsLeft, steps: [...endsLeft.steps, step] }]), layout }
  if (startsRight) {
    layout[startsRight.id] = cell
    return { intents: replace(doc, startsRight.id, [{ ...startsRight, steps: [step, ...startsRight.steps] }]), layout }
  }
  return { intents: [...doc.intents, { kind: 'workflow', id: newId, steps: [step] }], layout: { ...layout, [newId]: cell } }
}

/** Take a piece off the board: its workflow splits around it (the right part becomes workflow `newId`). */
export function take(doc: Connections, workflow: string, index: number, newId: string): Connections {
  const w = workflows(doc).find(x => x.id === workflow)
  if (!w || !w.steps[index]) return doc
  const cells = cellsOf(doc), start = cells[workflow]
  const before = w.steps.slice(0, index), after = w.steps.slice(index + 1)
  const layout = { ...cells }
  const parts: Intent[] = []
  if (before.length) parts.push({ ...w, steps: before }); else delete layout[workflow]
  if (after.length) {
    const id = before.length ? newId : workflow
    parts.push({ kind: 'workflow', id, enabled: w.enabled, steps: after })
    layout[id] = { c: start.c + index + 1, r: start.r }
  }
  return { intents: replace(doc, workflow, parts), layout }
}

/** Move a piece to another empty cell: take it off, then place it. */
export const move = (doc: Connections, workflow: string, index: number, cell: Cell, newIds: [string, string]): Connections => {
  const step = workflows(doc).find(w => w.id === workflow)?.steps[index]
  if (!step || at(doc, cell)) return doc
  return place(take(doc, workflow, index, newIds[0]), step, cell, newIds[1])
}

/** Change which instances a piece means (e.g. pin it to one instance when its component has several). */
export const pin = (doc: Connections, workflow: string, index: number, select: InstanceSel): Connections => ({
  ...doc,
  intents: doc.intents.map(i => i.kind === 'workflow' && i.id === workflow
    ? { ...i, steps: i.steps.map((s, j) => j === index ? { ...s, select } : s) } : i),
})

/** Switch an intent on or off. */
export const toggle = (doc: Connections, id: string, enabled: boolean): Connections =>
  ({ ...doc, intents: doc.intents.map(i => i.id === id ? { ...i, enabled } : i) })

export const addConnection = (doc: Connections, c: Connection): Connections => ({ ...doc, intents: [...doc.intents, c] })
export const remove = (doc: Connections, id: string): Connections => {
  const layout = { ...doc.layout }; delete layout[id]
  return { intents: doc.intents.filter(i => i.id !== id), layout }
}

/** A step for a palette piece: by component (the default), so it holds as long as there is one such instance. */
export const stepFor = (entry: PaletteEntry, piece: PieceSpec): Step => ({ select: { by: 'component', id: entry.component }, op: piece.op })

// ---------------------------------------------------------------- looks

export type Look = { hue: number; neck: number; head: number; lift: number; pattern: 'none' | 'stripes' | 'dots' | 'checks' }
/** A deterministic look from a type's SAID (its base64url characters as bytes). `any` gets a plain square slot. */
export function look(t: TypeInfo): Look {
  if (t.any) return { hue: 0, neck: 0.5, head: 0, lift: 0, pattern: 'none' }
  const b = (i: number) => (t.hash.charCodeAt(1 + (i % 43)) * 2654435761 >>> 0) % 1000 / 1000
  return {
    hue: Math.round(b(0) * 360), neck: 0.18 + b(1) * 0.12, head: 0.22 + b(2) * 0.14, lift: (b(3) - 0.5) * 0.3,
    pattern: (['none', 'stripes', 'dots', 'checks'] as const)[Math.floor(b(4) * 4)],
  }
}
