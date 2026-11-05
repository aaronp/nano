import Type from 'typebox'
import { Components } from '@composable/sdk'

const C = Components.declare({ author: 'composable', id: 'events-table' }, '0.1.0')
export const onEvent = C.action('on-event', 'Add a row recording the payload and who sent it', Type.Unknown())

export const eventsTable = C.define({
  state: () => ({ rows: [] as { at: string; from: string; data: unknown }[] }),
  actions: [[onEvent, (data, { state, inv }) => { state.rows.push({ at: new Date().toLocaleTimeString(), from: inv.from.instance, data }) }]],
})
