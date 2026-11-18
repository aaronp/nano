import { Coord } from '@pritzlaff/nano-core'
import { clock } from './pods/clock.ts'
import { simClock } from './pods/sim-clock.ts'
import { debounce } from './pods/debounce.ts'
import { input } from './pods/input.ts'
import { log } from './pods/log.ts'
import { map } from './pods/map.ts'

const ns = Coord.namespace('nano.ui')

export const uiProvider = ns.provider([input, debounce, map, log, clock, simClock])
