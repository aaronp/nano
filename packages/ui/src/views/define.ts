/**
 * The nano.ui default views, and `defineViews`, which defines their five tags (and `nano-pod-view`, `nano-explorer`, `nano-wiring`, `nano-time-machine`, `nano-ring`, `nano-filter`) once.
 *
 *   defineViews(); viewFor(pod, app.deployment(), views, overrides)
 */
import { NanoLog, NanoMap } from './faces.ts'
import { NanoDebounce } from './debounce.ts'
import { NanoInput } from './input.ts'
import { NanoExplorer } from '../explorer.ts'
import { NanoWiring } from '../wiring/wiring.ts'
import { NanoPodView } from './pod-view.ts'
import { NanoTimeMachine } from '../observe/bar.ts'
import { NanoRing } from '../observe/ring-view.ts'
import { NanoFilter } from '../filter/filter.ts'
import type { ViewMap } from './view.ts'

export const views: ViewMap = { 'nano.ui/input': 'nano-input', 'nano.ui/debounce': 'nano-debounce', 'nano.ui/map': 'nano-map', 'nano.ui/log': 'nano-log' }

const tags = { 'nano-filter': NanoFilter, 'nano-time-machine': NanoTimeMachine, 'nano-ring': NanoRing, 'nano-explorer': NanoExplorer, 'nano-wiring': NanoWiring, 'nano-pod-view': NanoPodView, 'nano-input': NanoInput, 'nano-debounce': NanoDebounce, 'nano-map': NanoMap, 'nano-log': NanoLog }

export function defineViews(): void {
  for (const [tag, cls] of Object.entries(tags)) if (!customElements.get(tag)) customElements.define(tag, cls)
}
