// Basic components to wire together, and their elements.
import { Filter, Map } from './components/code'
import { Debounce } from './components/debounce'
import { Input } from './components/input'
import { Log } from './components/log'
import { Range } from './components/range'

export { Debounce, Filter, Input, Log, Map, Range }
export type { Kind } from './components/input'
export type { Entry } from './components/log'

/** Every bundle component by kind, for whatever creates components by name (such as the platform). */
export const catalog = { input: Input, range: Range, log: Log, debounce: Debounce, map: Map, filter: Filter }
export * from './elements/elements'
