// What the three pods offer. `Entry` is shared on purpose: an event whose data has the same schema as an action's input can be piped to it.
import { Type } from 'typebox'
import { defineSchema, iface, op } from '@pritzlaff/nano-core'

export const Nothing = defineSchema('Nothing', Type.Null())
const Text = defineSchema('Text', Type.String())
const Texts = defineSchema('Texts', Type.Array(Type.String()))
const Maybe = defineSchema('MaybeText', Type.Union([Type.String(), Type.Null()]))
export const Entry = defineSchema('Entry', Type.Object({ key: Type.String(), value: Type.String() }))
const Entries = defineSchema('Entries', Type.Record(Type.String(), Type.String()))

export const Timer = iface('acme.template.Timer', {
  start: op.action('start', Nothing, Nothing),
  stop: op.action('stop', Nothing, Nothing),
  tick: op.event('tick', Entry),   // { key: 'tick', value: '<count>' }
})
export const Picker = iface('acme.template.Picker', {
  pick: op.action('pick', Text, Nothing),
  setOptions: op.action('setOptions', Texts, Nothing),
  changed: op.event('changed', Entry),   // { key: 'choice', value }
})
export const Store = iface('acme.template.Store', {
  get: op.action('get', Text, Maybe),
  set: op.action('set', Entry, Nothing),
  remove: op.action('remove', Text, Nothing),
  entries: op.action('entries', Nothing, Entries),
  changed: op.event('changed', Text),   // the key that changed
})
