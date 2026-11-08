export * from './types'
export { Components, Manifests, type Bound, type Builder, type Composite, type Deps, type Handle, type Model } from './components'
export { Systems as SystemRuntimes, type Binding, type ErrorInfo, type SystemRuntime, type Trace } from './system'
export { systemComponent, SystemOps } from './system-component'
export { Notifications, Calls, Subscriptions } from './wrappers'
export { missing, providerOf } from './deps'
export { canonicalType, typeHash, typeIndex, type OpRef } from './typehash'
export { canonical, digest, digestFor } from './data'

import { Systems as runtimes } from './system'
import { systemComponent, SystemOps } from './system-component'
import { notAllowed, type InstanceId } from './types'
import type { SystemRuntime } from './system'
/** Systems: `create` a runtime; `component(runtime)` exposes one through ops (`ops`). */
/** A view of `system` in which `as` may only act for itself (register, bind and subscribe as itself); reading is free. */
function restrict(system: SystemRuntime, as: InstanceId): SystemRuntime {
  const no = () => notAllowed(`${as} may only act for itself`)
  return {
    ...system,
    register: (id, c, o) => id === as ? system.register(id, c, o) : no(),
    unregister: id => id === as ? system.unregister(id) : no(),
    component: id => id === as ? system.component(id) : undefined,
    subscribe: s => s.listener === as ? system.subscribe(s) : no(),
    unsubscribe: id => system.snapshot().subscriptions.find(s => s.id === id)?.listener === as ? system.unsubscribe(id) : no(),
    bind: (from, d, to, op) => from === as ? system.bind(from, d, to, op) : no(),
    unbind: (from, d) => from === as ? system.unbind(from, d) : no(),
  }
}
export const Systems = { create: runtimes.create, component: systemComponent, ops: SystemOps, restrict }
