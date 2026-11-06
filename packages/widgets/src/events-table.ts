import Type from 'typebox'
import { Components } from '@composable/sdk'

const C = Components.declare({ author: 'composable', id: 'events-table' })
export const onEvent = C.op('on-event', 'Add a row recording the payload and who sent it', { input: Type.Unknown() })

export const eventsTable = C.define({
  state: () => ({ rows: [] as { at: string; from: string; data: unknown }[] }),
  handlers: [[onEvent, (data, { state, inv }) => { state.rows.push({ at: new Date().toLocaleTimeString(), from: inv.from, data }) }]],
})
