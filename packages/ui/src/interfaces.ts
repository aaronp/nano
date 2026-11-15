/**
 * The nano.ui contracts. Inputs are `Any` so a pipe from any event or result fits.
 *
 *   port(Input, Input.ops.submit)   // pipe source: what was submitted
 */
import { Type } from 'typebox'
import { defineSchema, iface, op } from '@pritzlaff/nano-core'

export const Any = defineSchema('Any', Type.Unknown())
export const Nothing = defineSchema('Nothing', Type.Null())
const Entries = defineSchema('Entries', Type.Array(Type.Unknown()))
const Text = defineSchema('Text', Type.String())
const Approval = defineSchema('Approval', Type.Object({ title: Type.String(), detail: Type.Optional(Type.String()) }))
const Approved = defineSchema('Approved', Type.Boolean())

/** Returns its input, so its result can be piped. */
export const Input = iface('nano.ui.Input', { submit: op.action('submit', Any, Any) })
export const Debounce = iface('nano.ui.Debounce', { push: op.action('push', Any, Nothing), flushed: op.event('flushed', Any) })
export const MapIface = iface('nano.ui.Map', { map: op.action('map', Any, Any) })
export const Log = iface('nano.ui.Log', {
  log: op.action('log', Any, Nothing),
  entries: op.action('entries', Nothing, Entries),
  clear: op.action('clear', Nothing, Nothing),
})
/** What the host offers a pod; implemented by the host, not here. */
export const HostUI = iface('nano.ui.HostUI', {
  alert: op.action('alert', Text, Nothing),
  approve: op.action('approve', Approval, Approved),
  setAppBar: op.action('setAppBar', Text, Nothing),
})
