/**
 * The `nano.ui` provider: input, debounce, map and log pods, and the HostUI interface a host implements.
 *
 *   registry.add(uiProvider)   // then Pod.lazy(log), Pod.eager(debounce, { config: { quietMs: 200 } })
 *   defineViews()              // the default `views`, and nano-pod-view for any pod
 */
import { uiProvider } from './provider.ts'

export { Any, Clock, ClockControl, Debounce, HostUI, Input, Log, MapIface, Nothing } from './interfaces.ts'
export { clock } from './pods/clock.ts'
export { simClock } from './pods/sim-clock.ts'
export { debounce } from './pods/debounce.ts'
export { input } from './pods/input.ts'
export { log } from './pods/log.ts'
export { map } from './pods/map.ts'
export { defineViews, views } from './views/define.ts'
export { circuitOf } from './wiring/model.ts'
export type { LayoutBox, LayoutData, LayoutSlot } from './layout.ts'
export { viewFor, type ViewMap, type ViewTarget } from './views/view.ts'
export { uiProvider }
export default uiProvider
