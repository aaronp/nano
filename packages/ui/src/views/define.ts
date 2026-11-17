/**
 * The nano.ui default views, and `defineViews`, which defines their five tags (and `nano-pod-view`, `nano-explorer`, `nano-wiring`) once.
 *
 *   defineViews(); viewFor(pod, { ...app.deployment(), views: selectors }, views)
 */
import { NanoDebounce, NanoInput, NanoLog, NanoMap } from './faces.ts'
import { NanoExplorer } from '../explorer.ts'
import { NanoWiring } from '../wiring/wiring.ts'
import { NanoPodView } from './pod-view.ts'
import type { ViewMap } from './view.ts'

export const views: ViewMap = { 'nano.ui/input': 'nano-input', 'nano.ui/debounce': 'nano-debounce', 'nano.ui/map': 'nano-map', 'nano.ui/log': 'nano-log' }

const tags = { 'nano-explorer': NanoExplorer, 'nano-wiring': NanoWiring, 'nano-pod-view': NanoPodView, 'nano-input': NanoInput, 'nano-debounce': NanoDebounce, 'nano-map': NanoMap, 'nano-log': NanoLog }

export function defineViews(): void {
  for (const [tag, cls] of Object.entries(tags)) if (!customElements.get(tag)) customElements.define(tag, cls)
}
