// The components available to wire: each with its ops. Settable as a whole, editable one op at a time.
import { Ops, type Op } from '@composable/core'
import { component, event, state } from '@composable/runes'

/** One available component: an instance id and its ops, the shape a registry snapshot lists. */
export type Entry = { id: string; ops: Op[] }
/** What is selected in the list. */
export type Selection = { component?: string; op?: string }

/** The list of available components, and which one (and which op) is selected. */
export const ComponentList = component('composable.editor/component-list', () => {
  const s = state({ components: [] as Entry[], selected: {} as Selection })
  const componentSelected = event(), opSelected = event(), removed = event()
  const find = (id: string) => {
    const c = s.components.find(c => c.id === id)
    if (!c) throw new Error(`no component ${id}`)
    return c
  }
  return {
    get components() { return s.components },
    get selected() { return s.selected },
    componentSelected, opSelected, removed,
    set: (list: Entry[]) => { s.components = list; s.selected = {} },
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
    },
    select: ({ component, op }: Selection & { component: string }) => {
      find(component)
      s.selected = op ? { component, op } : { component }
      componentSelected(component)
      if (op) opSelected({ component, op })
    },
  }
})
