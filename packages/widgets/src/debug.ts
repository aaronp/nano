import { Components } from '@composable/sdk'
import { eventsTable, onEvent } from './events-table'
import { setInput, submitted, textEmit } from './text-emit'

/** A text input whose submissions are listed in a table. Only the input's API is exposed. */
export const debug = Components.compose({
  id: { author: 'composable', id: 'debug' }, version: '0.1.0',
  children: { input: textEmit, table: eventsTable },
  routes: [{ from: ['input', submitted], to: ['table', onEvent] }],
  expose: [setInput, submitted],
})
