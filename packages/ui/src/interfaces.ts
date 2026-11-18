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
const Approved = Schema.define(Type.Boolean(), 'Approved')

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
