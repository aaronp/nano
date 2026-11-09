import Type from 'typebox'
import { ComponentId, Components, Instance, fail, ok, type SystemInstance } from '@composable/sdk'
import { plan, type Connection, type InstanceSel, type Status } from '@composable/connections'
import { board, type ComponentEntry } from '../model'
import { listed } from './component-list'
import type { TypesUpdated } from './type-editor'
import { any } from './schemas'

const Conns = any<board.Connections>()
const Cell = Type.Object({ c: Type.Number(), r: Type.Number() })
const At = { workflow: Type.String(), index: Type.Number() }

const C = Components.declare({ author: 'composable', id: 'connection-editor' })
export const ConnectionEditorOps = {
  setConnections: C.op('set-connections', 'Replace the connections', { input: Conns }),
  setComponents: C.op('set-components', 'The components (a component-list\'s components-updated)', { input: any<ComponentEntry[]>() }),
  setInstances: C.op('set-instances', 'The live instances, planned against', { input: Type.Array(Instance) }),
  setLooks: C.op('set-looks', 'The types and their looks (a type-editor\'s types-updated)', { input: any<TypesUpdated>() }),
  setLive: C.op('set-live', 'Switch Live: while on, intents go out on every change', { input: Type.Boolean() }),
  place: C.op('place', 'Put a piece in an empty cell', { input: Type.Object({ component: ComponentId, op: Type.String(), cell: Cell }), output: Conns }),
  take: C.op('take', 'Take a piece off the board', { input: Type.Object(At), output: Conns }),
  move: C.op('move', 'Move a piece to an empty cell', { input: Type.Object({ ...At, cell: Cell }), output: Conns }),
  pin: C.op('pin', 'Change which instances a piece means', { input: Type.Object({ ...At, select: any<InstanceSel>() }), output: Conns }),
  toggle: C.op('toggle', 'Switch an intent on or off', { input: Type.Object({ id: Type.String(), enabled: Type.Boolean() }), output: Conns }),
  addRule: C.op('add-rule', 'Add a fan-out connection rule', { input: Type.Object({ connection: any<Connection>() }), output: Conns }),
  remove: C.op('remove', 'Remove an intent', { input: Type.Object({ id: Type.String() }), output: Conns }),
  connectionsUpdated: C.op('connections-updated', 'The connections, as saved', { output: Conns }),
  // the same shape as the orchestrator's set-intents, so it can be linked there
  intentsUpdated: C.op('intents-updated', 'The intents, only while Live ([] on switching off)', { output: Type.Array(Type.Unknown()) }),
}
const o = ConnectionEditorOps

type State = {
  connections: board.Connections; components: ComponentEntry[]; instances: Instance[]; looks?: TypesUpdated
  live: boolean; status: Record<string, Status>
}

const replan = (s: State) => { s.status = plan(s.connections.intents, s.instances).status }
/** `rejected`: the edit's name, for place/take/move, which refuse by returning the same doc. */
const set = async (s: State, system: SystemInstance, connections: board.Connections, rejected?: string) => {
  if (rejected && connections === s.connections) return fail('validation', `${rejected} rejected`)
  s.connections = connections
  replan(s)
  await system.notify(o.connectionsUpdated, connections)
  if (s.live) await system.notify(o.intentsUpdated, connections.intents)
  return ok(connections)
}
const id = () => crypto.randomUUID()

export const connectionEditor = C.define({
  state: (): State => ({ connections: board.emptyConnections(), components: [], instances: [], live: false, status: {} }),
  handlers: [
    [o.setConnections, async (c, { state, system }) => { await set(state, system, c) }],
    [o.setComponents, (components, { state }) => { state.components = components }],
    [o.setInstances, (instances, { state }) => { state.instances = listed(instances); replan(state) }],
    [o.setLooks, (looks, { state }) => { state.looks = looks }],
    [o.setLive, async (on, { state, system }) => {
      if (on === state.live) return
      state.live = on
      await system.notify(o.intentsUpdated, on ? state.connections.intents : [])
    }],
    [o.place, ({ component, op, cell }, { state, system }) =>
      set(state, system, board.place(state.connections, { select: { by: 'component', id: component }, op }, cell, id()), 'place')],
    [o.take, ({ workflow, index }, { state, system }) => set(state, system, board.take(state.connections, workflow, index, id()), 'take')],
    [o.move, ({ workflow, index, cell }, { state, system }) => set(state, system, board.move(state.connections, workflow, index, cell, [id(), id()]), 'move')],
    [o.pin, ({ workflow, index, select }, { state, system }) => set(state, system, board.pin(state.connections, workflow, index, select))],
    [o.toggle, ({ id, enabled }, { state, system }) => set(state, system, board.toggle(state.connections, id, enabled))],
    [o.addRule, ({ connection }, { state, system }) => set(state, system, board.addConnection(state.connections, connection))],
    [o.remove, ({ id }, { state, system }) => set(state, system, board.remove(state.connections, id))],
  ],
})
