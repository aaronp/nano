/**
 * The messenger's contracts: a key-value store, a messaging channel, and the inbox and composer widgets that use them.
 *
 *   const kv = ctx.one(KeyValueStore)               // success(Selection): kv.value.call.put({ key: 'inbox', value: '[]' })
 *   if (ctx.all(Messaging).length === 0) …          // nothing wired: the composer is disabled
 */
import { Type } from 'typebox'
import { Schema, Interface, Op } from '@pritzlaff/nano-core'

export const Key = Schema.define(Type.String(), 'Key')
export const MaybeValue = Schema.define(Type.Union([Type.String(), Type.Null()]), 'MaybeValue')
export const Entry = Schema.define(Type.Object({ key: Type.String(), value: Type.String() }), 'Entry')
export const Done = Schema.define(Type.Null(), 'Done')

export const Message = Schema.define(Type.Object({ id: Type.String(), text: Type.String() }), 'Message')
export const Messages = Schema.define(Type.Array(Message), 'Messages')
export const Nothing = Schema.define(Type.Object({}), 'Nothing')
export const Draft = Schema.define(Type.Object({ text: Type.String() }), 'Draft')
/** Disabled is a value: the composer has no messaging to send through. */
export const Sent = Schema.define(Type.Union([
  Type.Object({ status: Type.Literal('sent'), id: Type.String() }),
  Type.Object({ status: Type.Literal('disabled') }),
]), 'Sent')

export const KeyValueStore = Interface.define('example.messenger.KeyValueStore', {
  get: Op.action(Key, MaybeValue),
  put: Op.action(Entry, Done),
})

export const Messaging = Interface.define('example.messenger.Messaging', {
  post: Op.action(Message, Done),
  messages: Op.event(Message),
})

export const Inbox = Interface.define('example.messenger.Inbox', {
  receive: Op.action(Message, Done),
  list: Op.action(Nothing, Messages),
})

export const Composer = Interface.define('example.messenger.Composer', {
  send: Op.action(Draft, Sent),
})

export const Outgoing = Schema.define(Type.Object({ contact: Type.String(), message: Type.String() }), 'Outgoing')
/** `send(contact, message)`: one pod, shared by every runtime it is placed in. */
export const Send = Interface.define('example.messenger.Send', { send: Op.action(Outgoing, Done) })
