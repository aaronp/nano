// What the three pods offer. `Entry` is shared on purpose: an event whose data has the same schema as an action's input can be piped to it.
import { Type } from 'typebox'
import { Schema, Interface, Op } from '@pritzlaff/nano-core'

export const Nothing = Schema.define(Type.Null(), 'Nothing')
const Text = Schema.define(Type.String(), 'Text')
const Texts = Schema.define(Type.Array(Type.String()), 'Texts')
const Maybe = Schema.define(Type.Union([Type.String(), Type.Null()]), 'MaybeText')
export const Entry = Schema.define(Type.Object({ key: Type.String(), value: Type.String() }), 'Entry')
const Entries = Schema.define(Type.Record(Type.String(), Type.String()), 'Entries')

export const Timer = Interface.define('acme.template.Timer', {
  start: Op.action(Nothing, Nothing),
  stop: Op.action(Nothing, Nothing),
  tick: Op.event(Entry),   // { key: 'tick', value: '<count>' }
})
export const Picker = Interface.define('acme.template.Picker', {
  pick: Op.action(Text, Nothing),
  setOptions: Op.action(Texts, Nothing),
  options: Op.action(Nothing, Texts),
  changed: Op.event(Entry),   // { key: 'choice', value }
})
export const Store = Interface.define('acme.template.Store', {
  get: Op.action(Text, Maybe),
  set: Op.action(Entry, Nothing),
  remove: Op.action(Text, Nothing),
  entries: Op.action(Nothing, Entries),
  changed: Op.event(Text),   // the key that changed
})
