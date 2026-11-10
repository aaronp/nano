// Schemas for the editor's values. Rich internal shapes (ops, pieces, looks, type entries) are described, not
// spelled out: `Type.Unsafe` keeps their TS type for the code and says what they are for the views.
import { Type, type TSchema } from 'typebox'
import { SubscriptionSchema, type Op } from '@pritzlaff/nano-core'
import type { Look, TypeEntry } from '../model'
import type { Piece } from '../model/board'
import type { Entry, Selection } from './component-list'

const described = <T>(description: string, examples?: unknown[]) => Type.Unsafe<T>(Type.Unknown({ description, ...(examples && { examples }) }))

export const OpSchema = described<Op>('An op: its ns, name, input and output schemas', [{ ns: 'composable.bundle/range', name: 'value' }])
export const EntrySchema = described<Entry>('A component to wire: an instance id and its ops', [{ id: 'ex-range', ops: [] }])
export const SelectionSchema = described<Selection>('What is selected: a component, and maybe one of its ops', [{ component: 'ex-range', op: 'composable.bundle/range/value' }])
export const TypeEntrySchema = described<TypeEntry>('A named type (a TypeBox schema with a title) and its look', [{ type: { title: 'Point', type: 'object', properties: {} } }])
export const LookSchema = described<Look>("A type's look: its jigsaw edge, colour and pattern")
export const PieceSchema = described<Piece>('One op of one instance, placed on a cell', [{ instance: 'ex-range', op: { ns: 'composable.bundle/range', name: 'value' }, cell: { c: 0, r: 0 } }])
export const SchemaSchema = described<TSchema>('A TypeBox schema', [{ type: 'number' }])
export const CellSchema = Type.Object({ c: Type.Integer({ minimum: 0, description: 'Column' }), r: Type.Integer({ minimum: 0, description: 'Row' }) },
  { description: 'A board cell', examples: [{ c: 2, r: 1 }] })
export const ConnectionSchema = Type.Omit(SubscriptionSchema, ['id'], { description: 'A design-time connection: a subscription without its id' })
export const name = (description: string, examples: string[]) => Type.String({ description, examples })
export const rename = Type.Object({ from: Type.String({ description: 'The current title' }), to: Type.String({ description: 'The new title' }) },
  { description: 'From one title to another', examples: [{ from: 'Point', to: 'Position' }] })
