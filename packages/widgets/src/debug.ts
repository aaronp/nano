import { Components } from '@composable/sdk'
import { eventsTable, onEvent } from './events-table'
import { setInput, submitted, textEmit } from './text-emit'

/** A text input whose submissions are listed in a table. Only the input's API is exposed. */
export const debug = Components.compose({ id: { author: 'composable', id: 'debug' } }, c => {
  const input = c.use('input', textEmit)
  const table = c.use('table', eventsTable)
  c.route(input(submitted), table(onEvent))
  c.expose(setInput, submitted)
  return { input, table }
})
