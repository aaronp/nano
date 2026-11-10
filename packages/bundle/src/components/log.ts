// A log of whatever is sent to it, by level. Subscribe any source to debug, info or warn.
import { Type } from 'typebox'
import { component, state } from '@pritzlaff/nano-runes'

/** One logged value. */
export type Entry = { time: number; level: 'debug' | 'info' | 'warn'; value: unknown }

const anything = Type.Unknown({ description: 'Any value', examples: [42, 'hello', { x: 1 }] })

/** Collects entries from its three sinks; `clear` empties it. */
export const Log = component('composable.bundle/log', () => {
  const s = state({ entries: [] as Entry[] })
  const at = (level: Entry['level']) => (value: unknown) => { s.entries.push({ time: Date.now(), level, value }) }
  return { get entries() { return s.entries }, debug: at('debug'), info: at('info'), warn: at('warn'), clear: () => { s.entries = [] } }
}, {
  entries: Type.Array(Type.Object({
    time: Type.Number({ description: 'When it arrived, ms since the epoch' }),
    level: Type.Union([Type.Literal('debug'), Type.Literal('info'), Type.Literal('warn')]),
    value: Type.Unknown({ description: 'What was logged' }),
  }), { description: 'Every entry, oldest first', examples: [[{ time: 1731240000000, level: 'info', value: 42 }]] }),
  debug: { in: anything, description: 'Logs a value at debug level' },
  info: { in: anything, description: 'Logs a value at info level' },
  warn: { in: anything, description: 'Logs a value at warn level' },
  clear: { description: 'Empties the log' },
}, { description: 'A log of whatever is sent to it, by level' })
