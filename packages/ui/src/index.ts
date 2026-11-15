/**
 * The `nano.ui` provider: input, debounce, map and log pods, and the HostUI interface a host implements.
 *
 *   registry.add(uiProvider)   // then Pod.lazy(log), Pod.eager(debounce, { config: { quietMs: 200 } })
 *   defineViews()              // the default `views`, and nano-pod-view for any pod
 *   importApp(url, loaded)     // a nano.json and its provider modules, merged into what is loaded
 */
import { uiProvider } from './provider.ts'

export { Any, Debounce, HostUI, Input, Log, MapIface, Nothing } from './interfaces.ts'
export { debounce } from './pods/debounce.ts'
export { input } from './pods/input.ts'
export { log } from './pods/log.ts'
export { map } from './pods/map.ts'
export { importApp, merge, type Loaded } from './import.ts'
export { defineViews, views } from './views/define.ts'
export { circuitOf } from './wiring/model.ts'
export { viewFor, type ViewMap, type ViewTarget } from './views/view.ts'
export { uiProvider }
export default uiProvider
