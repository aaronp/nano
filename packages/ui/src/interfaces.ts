/**
 * The nano.ui contracts. Inputs are `Any` so a pipe from any event or result fits.
 *
 *   port(Input, Input.ops.submit)   // pipe source: what was submitted
 */
import { Type } from 'typebox'
import { Schema, Interface, Op } from '@pritzlaff/nano-core'

export const Any = Schema.define('Any', Type.Unknown())
export const Nothing = Schema.define('Nothing', Type.Null())
const Entries = Schema.define('Entries', Type.Array(Type.Unknown()))
const Text = Schema.define('Text', Type.String())
const Approval = Schema.define('Approval', Type.Object({ title: Type.String(), detail: Type.Optional(Type.String()) }))
const Approved = Schema.define('Approved', Type.Boolean())

/** Returns its input, so its result can be piped. */
export const Input = Interface.define('nano.ui.Input', { submit: Op.action('submit', Any, Any) })
export const Debounce = Interface.define('nano.ui.Debounce', { push: Op.action('push', Any, Nothing), flushed: Op.event('flushed', Any) })
export const MapIface = Interface.define('nano.ui.Map', { map: Op.action('map', Any, Any) })
export const Log = Interface.define('nano.ui.Log', {
  log: Op.action('log', Any, Nothing),
  entries: Op.action('entries', Nothing, Entries),
  clear: Op.action('clear', Nothing, Nothing),
})
/** What the host offers a pod; implemented by the host, not here. */
export const HostUI = Interface.define('nano.ui.HostUI', {
  alert: Op.action('alert', Text, Nothing),
  approve: Op.action('approve', Approval, Approved),
  setAppBar: Op.action('setAppBar', Text, Nothing),
})
