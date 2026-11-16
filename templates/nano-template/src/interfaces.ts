// What the three pods offer. `Entry` is shared on purpose: an event whose data has the same schema as an action's input can be piped to it.
import { Type } from 'typebox'
import { Schema, Interface, Op } from '@pritzlaff/nano-core'

export const Nothing = Schema.define('Nothing', Type.Null())
const Text = Schema.define('Text', Type.String())
const Texts = Schema.define('Texts', Type.Array(Type.String()))
const Maybe = Schema.define('MaybeText', Type.Union([Type.String(), Type.Null()]))
export const Entry = Schema.define('Entry', Type.Object({ key: Type.String(), value: Type.String() }))
const Entries = Schema.define('Entries', Type.Record(Type.String(), Type.String()))

export const Timer = Interface.define('acme.template.Timer', {
  start: Op.action('start', Nothing, Nothing),
  stop: Op.action('stop', Nothing, Nothing),
  tick: Op.event('tick', Entry),   // { key: 'tick', value: '<count>' }
})
export const Picker = Interface.define('acme.template.Picker', {
  pick: Op.action('pick', Text, Nothing),
  setOptions: Op.action('setOptions', Texts, Nothing),
  options: Op.action('options', Nothing, Texts),
  changed: Op.event('changed', Entry),   // { key: 'choice', value }
})
export const Store = Interface.define('acme.template.Store', {
  get: Op.action('get', Text, Maybe),
  set: Op.action('set', Entry, Nothing),
  remove: Op.action('remove', Text, Nothing),
  entries: Op.action('entries', Nothing, Entries),
  changed: Op.event('changed', Text),   // the key that changed
})
