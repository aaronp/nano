/**
 * The nano.ui contracts. Inputs are `Any` so a pipe from any event or result fits.
 *
 *   port(Input, Input.ops.submit)   // pipe source: what was submitted
 */
import { Type } from 'typebox'
import { Coord, Schema, Op } from '@pritzlaff/nano-core'

const ns = Coord.namespace('nano.ui')

export const Any = Schema.define(Type.Unknown(), 'Any')
export const Nothing = Schema.define(Type.Null(), 'Nothing')
const Entries = Schema.define(Type.Array(Type.Unknown()), 'Entries')
const Text = Schema.define(Type.String(), 'Text')
const Approval = Schema.define(Type.Object({ title: Type.String(), detail: Type.Optional(Type.String()) }), 'Approval')
const Num = Schema.define(Type.Number(), 'Num')
const TimerId = Schema.define(Type.Integer({ minimum: 1 }), 'TimerId')
const After = Schema.define(Type.Object({ ms: Type.Integer({ minimum: 0, maximum: 2147483647 }), tag: Type.Optional(Type.String()) }), 'After')
const Fired = Schema.define(Type.Object({ id: Type.Integer({ minimum: 1 }), tag: Type.Optional(Type.String()), at: Type.Number() }), 'Fired')
const Approved = Schema.define(Type.Boolean(), 'Approved')
// Shape-checked only, as nano-core's own deployment shape is: the apply assembles them strictly.
const Addition = Schema.define(Type.Object({
  pods: Type.Record(Type.String(), Type.Unknown()), runtimes: Type.Record(Type.String(), Type.Unknown()),
  onConflict: Type.Optional(Type.Union([Type.Literal('error'), Type.Literal('overwrite')])),
}), 'Addition')
const Removal = Schema.define(Type.Object({ runtimes: Type.Array(Type.String()) }), 'Removal')
const Box = Type.Object({ x: Type.Number(), y: Type.Number(), w: Type.Number(), h: Type.Number() })
const Slot = Type.Union([Type.Object({ id: Type.String(), runtime: Type.String(), pod: Type.String() }), Type.Object({ id: Type.String(), view: Type.String() })])
const PageT = Type.Object({ id: Type.String(), title: Type.String(), icon: Type.Optional(Type.String()), slots: Type.Array(Slot), geometry: Type.Optional(Type.Record(Type.String(), Box)) })
const Pages = Schema.define(Type.Array(PageT), 'Pages')
const PageAt = Schema.define(Type.Object({ page: PageT, index: Type.Optional(Type.Integer({ minimum: 0 })) }), 'PageAt')
const PageId = Schema.define(Type.String(), 'PageId')

/** Each returns its input, so its result can be piped: `submit` when the user submits, `change` on every edit. */
export const Input = ns.interface('Input', { submit: Op.action(Any, Any), change: Op.action(Any, Any) })
/** A flush publishes the newest value as `flushed` and everything queued since the last flush, oldest first, as `batch`. */
export const Debounce = ns.interface('Debounce', { push: Op.action(Any, Nothing), flushed: Op.event(Any), batch: Op.event(Entries) })
export const MapIface = ns.interface('Map', { map: Op.action(Any, Any) })
export const Log = ns.interface('Log', {
  log: Op.action(Any, Nothing),
  entries: Op.action(Nothing, Entries),
  clear: Op.action(Nothing, Nothing),
})
/** What the host offers a pod; implemented by the host, not here. */
export const HostUI = ns.interface('HostUI', {
  alert: Op.action(Text, Nothing),
  approve: Op.action(Approval, Approved),
  setAppBar: Op.action(Text, Nothing),
})
/** What the host offers a pod to change the deployment: `deploy` adds pods and runtimes (an existing name is
 * `invalid-input`, or with `onConflict: 'overwrite'` replaced), `undeploy` removes runtimes and the pods placed nowhere else. The host's deployment policy decides. */
export const HostDeploy = ns.interface('HostDeploy', { deploy: Op.action(Addition, Nothing), undeploy: Op.action(Removal, Nothing) })
/** The pages of the layout: `pages` lists them, `setPage` adds or replaces one (by id, at `index` if given), `removePage` drops one, `open` shows one. */
export const HostPages = ns.interface('HostPages', {
  pages: Op.action(Nothing, Pages), setPage: Op.action(PageAt, Nothing), removePage: Op.action(PageId, Nothing), open: Op.action(PageId, Nothing),
})
/** Time and timers: `after` starts a timer and returns its id, `fired` is published when it is due, at the clock's time. */
export const Clock = ns.interface('Clock', {
  now: Op.action(Nothing, Num), after: Op.action(After, TimerId), cancel: Op.action(TimerId, Nothing), fired: Op.event(Fired),
})
/** Moves a simulated clock; `set` may not go back. */
export const ClockControl = ns.interface('ClockControl', { advance: Op.action(Num, Nothing), set: Op.action(Num, Nothing) })
/** A float in [0, 1); pods scale it themselves. */
export const Random = ns.interface('Random', { next: Op.action(Nothing, Num) })
