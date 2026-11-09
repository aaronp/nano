// The prototype's constants and data shapes, kept under its own names so the two read side by side.

/** A 2D point [u, v] in edge space (or [x, y] on the board). */
export type Pt = [number, number]
/** One cubic segment: two control points and its end point. */
export interface Seg { c1: Pt; c2: Pt; p: Pt }
/** An edge shape: a start point and cubic segments, tagged with the preset it came from. */
export interface Shape { preset: string; start: Pt; segs: Seg[] }
/** A side of a tile. */
export type Side = 'T' | 'R' | 'B' | 'L'
/** A record field. */
export interface Field { name: string; typeId: string; array: boolean }
/** A type: built-in primitive, record or alias (brand), with its look. */
export interface TypeDef {
  id: string; name: string; kind: 'primitive' | 'record' | 'alias'; builtIn: boolean
  shape: Shape; colour: string; pattern: string; shapeSource?: 'sha' | 'custom'; sha?: string
  fields?: Field[]; aliasFor?: string
}
/** A reference to a type, maybe as an array. */
export interface Ref { typeId: string; array: boolean }
/** An action of an element: an input (hole), an output (knob), or both. */
export interface Action { id: string; elementId: string; name: string; input: Ref | null; output: Ref | null; inputSide: 'L' | 'T'; outputSide: 'R' | 'B' }
/** An element: a namespace for actions. */
export interface PElement { id: string; name: string }
/** A board cell. */
export interface Cell { c: number; r: number }
/** The whole saved model. */
export interface Model { types: TypeDef[]; elements: PElement[]; actions: Action[]; placements: Record<string, Cell>; nextId: number }

export const CELL = 120
export const PAD = 40
export const COLS = 8
export const ROWS = 6
export const OX = 80
export const OY = 110
export const CANVAS_W = 1120
export const SIDES: Side[] = ['T', 'R', 'B', 'L']
export const DIRS: Record<Side, Pt> = { T: [0, -1], R: [1, 0], B: [0, 1], L: [-1, 0] }
export const OPP: Record<Side, Side> = { T: 'B', B: 'T', L: 'R', R: 'L' }
export const U0 = 34
export const U1 = 86
export const SAMPLES = [38, 42, 46, 50, 54, 58, 62, 66, 70, 74, 78, 82]
/** Differs from the prototype's 'puzzle-proto-v2' so the two keep separate state. */
export const STORE_KEY = 'puzzle-port-v1'
export const BAD = '#FF6B6B'
export const SWATCHES = ['#5ED6B4', '#F5CF5B', '#FF8FC0', '#9B8CFF', '#7CC7FF', '#FF9F7A', '#C5F27A', '#66D9E8', '#F2A7C8', '#D9D27A', '#E8833A', '#B0B8C8']
export const PATTERNS = [{ id: 'none', label: 'None' }, { id: 'diag', label: 'Diagonal /' }, { id: 'diag2', label: 'Diagonal \\' }, { id: 'vert', label: 'Vertical' }, { id: 'horiz', label: 'Horizontal' }, { id: 'dots', label: 'Dots' }]
export const ROLES = {
  source: { fill: '#2B2015', stroke: '#FFA45C', label: 'source' },
  transform: { fill: '#172234', stroke: '#6FA8FF', label: 'transform' },
  sink: { fill: '#15281F', stroke: '#7CE3A1', label: 'sink' }
}
export const UMIN = 4
export const UMAX = 116
export const VMAX = 38

/** The prototype's `bug`: an invariant broke. */
export function bug(msg: string): never { throw new Error('bug: ' + msg) }
/** Rounds to one decimal. */
export function round1(n: number) { return Math.round(n * 10) / 10 }
/** Formats a point for an SVG path. */
export function fmt(p: Pt) { return round1(p[0]) + ' ' + round1(p[1]) }
/** Indexes a list by id. */
export function byIdOf<T extends { id: string }>(list: T[]): Record<string, T> { return Object.fromEntries(list.map(t => [t.id, t])) }
