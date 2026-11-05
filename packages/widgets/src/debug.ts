import { Components } from '@composable/sdk'
import { eventsTable, onEvent } from './events-table'
import { submitted, textEmit } from './text-emit'

export const debug = Components.compose(
  { id: { author: 'composable', id: 'debug' }, version: '0.1.0' },
  { input: textEmit, table: eventsTable },
  [{ from: ['input', submitted], to: ['table', onEvent] }],
)
