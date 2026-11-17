// The Circuit's data and the pad typing. Pure: no Lit, no DOM. A layer is a runtime (`screen` is its id).
import type { TSchema } from 'typebox'

export type PadType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'signal' | 'any' | 'call'

/** A pad's data type, from its schema's type: none (or Void) is a signal; unions, Unknown and the rest are any. */
export function padTypeOf(schema: TSchema | undefined): PadType {
  if (!schema) return 'signal'
  const t = (schema as { type?: unknown }).type
  if (t === 'void' || t === 'undefined') return 'signal'
  if (t === 'string' || t === 'boolean' || t === 'object' || t === 'array') return t
  if (t === 'number' || t === 'integer') return 'number'
  return 'any'
}

/** An event is round, an action a rounded square; an input is hollow, an output filled. */
export type Pad = { key: string; instance: string; op: string; label: string; dir: 'in' | 'out'; kind: 'event' | 'call'; type: PadType; description?: string; schema?: TSchema }
export type Box = { x: number; y: number; w: number; h: number }
export type Footprint = { system: string; instance: string; title: string; box: Box; shared: boolean; pads: Pad[] }
export type Layer = { screen: string; title: string; system: string; footprints: Footprint[] }
export type SideItem = { system: string; instance: string; title: string; pads: Pad[] }
export type SystemBlock = { system: string; items: SideItem[] }
/** Where a cable end sits: on a runtime's layer, or in the side area (the block's system id). */
export type CableEnd = { pad: string; at: { layer: string } | { side: string } }
/** `id` is `runtime|from|to|port|source` for a pipe, `runtime|from|to|call|` for a call edge. */
export type Cable = { id: string; system: string; from: CableEnd; to: CableEnd; type: PadType }
export type Circuit = { layers: Layer[]; side: SystemBlock[]; cables: Cable[] }
