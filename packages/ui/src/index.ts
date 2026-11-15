/**
 * The `nano.ui` provider: input, debounce, map and log pods, and the HostUI interface a host implements.
 *
 *   registry.add(uiProvider)   // then Pod.lazy(log), Pod.eager(debounce, { config: { quietMs: 200 } })
 */
import { uiProvider } from './provider.ts'

export { Any, Debounce, HostUI, Input, Log, MapIface, Nothing } from './interfaces.ts'
export { debounce } from './pods/debounce.ts'
export { input } from './pods/input.ts'
export { log } from './pods/log.ts'
export { map } from './pods/map.ts'
export { uiProvider }
export default uiProvider
