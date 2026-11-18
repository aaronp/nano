// The view's state and its starting values.
import type { Pills } from './filter'
import type { Jack, Model } from './model'

/** A cord being dragged: from `anchor`, maybe picked off a plugged input (`picked` is that wire). */
export type Cord = { anchor: string; picked: string | null; x: number; y: number; hover: string | null; err: string | null }
/** A message in flight along a wire (a subscription), from a trace delivery. */
export type Packet = { id: number; wire: string; born: number; label: string }
/** What is selected: a pod, or one of its ports (`system` is the runtime shown). */
export type Selection = { system: string; instance: string; op?: string } | null
/** An edit's outcome, as the old Application's: a value, or a refusal. */
export type Result = { value?: unknown } | { error: string }
/** What the host can make: an implementation's title and jacks, by its coordinate. */
export type Catalog = Record<string, { title: string; jacks: Jack[] }>
/** All of the view's state. */
export interface State {
  ry: number; rx: number; dragging: boolean; mode: 'relay' | 'puzzle'; sel: string | null; depth: number; showCalls: boolean; showPipes: boolean
  /** Show only the jacks a cord touches, or all; the selected filter pills. */
  show: 'connected' | 'all'; pills: Pills; editing: boolean; entering: boolean; leaving: boolean; hl: boolean
  /** Zoom (1 = fitted) and pan (screen px) on top of the camera; `zooming` makes them follow the wheel without easing. */
  zoom: number; panX: number; panY: number; zooming: boolean
  /** The drawer's tab, and what is selected (the Application's selection, kept in step through the trace). */
  tab: 'view' | 'detail'; picked: Selection
  cord: Cord | null; armed: string | null; selMod: string | null; lift: string | null; toast: { kind: 'ok' | 'err'; text: string } | null
  packets: Packet[]; hits: Record<string, number>; flashes: Record<string, number>; stats: Record<string, { in: number; out: number }>
}

/** The state a view starts in. */
export const initial = (): State => ({ ry: 0, rx: 0, dragging: false, mode: 'relay', sel: null, depth: 64, showCalls: true, showPipes: true, show: 'connected', pills: { runtimes: [], pods: [], kinds: [] }, editing: false, entering: false, leaving: false, hl: false, zoom: 1, panX: 0, panY: 0, zooming: false, tab: 'view', picked: null, cord: null, armed: null, selMod: null, lift: null, toast: null, packets: [], hits: {}, flashes: {}, stats: {} })
/** The model before the first build. */
export const empty = (): Model => ({ W: 1340, H: 560, chassis: [], rack: [], P: {}, wires: [], routes: [], calls: [], rackH: 128, runtimes: {} })
