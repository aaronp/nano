// A log of whatever is sent to it, by level. Subscribe any source to debug, info or warn.
import { component, state } from '@composable/runes'

/** One logged value. */
export type Entry = { time: number; level: 'debug' | 'info' | 'warn'; value: unknown }

/** Collects entries from its three sinks; `clear` empties it. */
export const Log = component('composable.bundle/log', () => {
  const s = state({ entries: [] as Entry[] })
  const at = (level: Entry['level']) => (value: unknown) => { s.entries.push({ time: Date.now(), level, value }) }
  return { get entries() { return s.entries }, debug: at('debug'), info: at('info'), warn: at('warn'), clear: () => { s.entries = [] } }
})
