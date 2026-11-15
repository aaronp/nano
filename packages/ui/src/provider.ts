import { provider } from '@pritzlaff/nano-core'
import { debounce } from './pods/debounce.ts'
import { input } from './pods/input.ts'
import { log } from './pods/log.ts'
import { map } from './pods/map.ts'

export const uiProvider = provider('nano.ui', [input, debounce, map, log])
