// Basic components to wire together, and their elements.
import type { Catalog } from '@composable/elements'
import { Filter, Map } from './components/code'
import { Debounce } from './components/debounce'
import { Input } from './components/input'
import { Log } from './components/log'
import { Range } from './components/range'

export { Debounce, Filter, Input, Log, Map, Range }
export type { Kind } from './components/input'
export type { Entry } from './components/log'

/** The bundle's kinds of component, with their titles and elements, for a host to list (and the platform to make). */
export const catalog = {
  input: { component: Input, title: 'Input', tag: 'c-input' },
  range: { component: Range, title: 'Range', tag: 'c-range' },
  log: { component: Log, title: 'Log', tag: 'c-log' },
  debounce: { component: Debounce, title: 'Debounce', tag: 'c-debounce' },
  map: { component: Map, title: 'Map', tag: 'c-map' },
  filter: { component: Filter, title: 'Filter', tag: 'c-filter' },
} satisfies Catalog
export * from './elements/elements'
