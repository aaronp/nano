// The components available to wire: each with its ops. Settable as a whole, editable one op at a time.
import { Ops, type Op } from '@pritzlaff/nano-core'
import { Type } from 'typebox'
import { component, event, state } from '@pritzlaff/nano-runes'
import { EntrySchema, OpSchema, SelectionSchema, name } from './schemas'

/** One available component: an instance id and its ops, the shape a registry snapshot lists. */
export type Entry = { id: string; ops: Op[] }
/** What is selected in the list. */
export type Selection = { component?: string; op?: string }

const id = name('A component (instance) id', ['ex-range'])
const OpAt = Type.Object({ component: id, op: name('An op key', ['composable.bundle/range/value']) }, { description: 'One op of one component' })

/** The list of available components, and which one (and which op) is selected. */
export const ComponentList = component('composable.editor/component-list', () => {
  const s = state({ components: [] as Entry[], selected: {} as Selection })
  const componentSelected = event(), opSelected = event(), removed = event(), opRemoved = event<typeof OpAt>()
  const find = (id: string) => {
    const c = s.components.find(c => c.id === id)
    if (!c) throw new Error(`no component ${id}`)
    return c
  }
  return {
    get components() { return s.components },
    get selected() { return s.selected },
    componentSelected, opSelected, removed, opRemoved,
    set: (list: Entry[]) => {
      const gone = s.components.filter(c => !list.some(n => n.id === c.id)).map(c => c.id)
      s.components = list; s.selected = {}
      for (const id of gone) removed(id)
    },
    add: (e: Entry) => {
      if (s.components.some(c => c.id === e.id)) throw new Error(`${e.id} is already listed`)
      s.components.push(e)
    },
    remove: (id: string) => {
      find(id)
      s.components = s.components.filter(c => c.id !== id)
      if (s.selected.component === id) s.selected = {}
      removed(id)
    },
    addOp: ({ component, op }: { component: string; op: Op }) => {
      const c = find(component)
      if (c.ops.some(o => Ops.key(o) === Ops.key(op))) throw new Error(`${component} already has ${Ops.key(op)}`)
      c.ops.push(op)
    },
    removeOp: ({ component, op }: { component: string; op: string }) => {
      const c = find(component), i = c.ops.findIndex(o => Ops.key(o) === op)
      if (i < 0) throw new Error(`${component} has no ${op}`)
      c.ops.splice(i, 1)
      opRemoved({ component, op })
    },
    select: ({ component, op }: Selection & { component: string }) => {
      find(component)
      s.selected = op ? { component, op } : { component }
      componentSelected(component)
      if (op) opSelected({ component, op })
    },
  }
}, {
  components: Type.Array(EntrySchema, { description: 'Every component listed, with its ops' }),
  selected: SelectionSchema,
  componentSelected: Type.String({ description: 'A component was selected: its id', examples: ['ex-range'] }),
  opSelected: Type.Object({ component: id, op: Type.String({ description: 'An op key' }) }, { description: 'An op was selected' }),
  removed: Type.String({ description: 'A component left the list: its id', examples: ['ex-range'] }),
  opRemoved: Type.Object({ component: id, op: Type.String({ description: 'An op key' }) }, { description: "An op left a component's list" }),
  set: { in: Type.Array(EntrySchema, { description: 'The new list' }), description: 'Replaces the list, publishing removed for each component that left it' },
  add: { in: EntrySchema, description: 'Adds a component to the list' },
  remove: { in: id, description: 'Removes a component, publishing removed' },
  addOp: { in: Type.Object({ component: id, op: OpSchema }, { description: 'A component and the op to add' }), description: "Adds an op to a component's list" },
  removeOp: { in: OpAt, description: "Removes an op from a component's list, publishing opRemoved" },
  select: { in: Type.Object({ component: id, op: Type.Optional(Type.String({ description: 'An op key' })) }, { description: 'A component, and maybe one of its ops' }),
    description: 'Selects a component (and maybe an op), publishing componentSelected and opSelected' },
}, { description: 'The components available to wire, and which one is selected' })
