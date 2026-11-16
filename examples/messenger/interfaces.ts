/**
 * The messenger's contracts: a key-value store, a messaging channel, and the inbox and composer widgets that use them.
 *
 *   const kv = ctx.one(KeyValueStore)               // Selection: kv.call.put({ key: 'inbox', value: '[]' })
 *   if (ctx.all(Messaging).length === 0) …          // nothing wired: the composer is disabled
 */
import { Type } from 'typebox'
import { Schema, Interface, Op } from '@pritzlaff/nano-core'

export const Key = Schema.define('Key', Type.String())
export const MaybeValue = Schema.define('MaybeValue', Type.Union([Type.String(), Type.Null()]))
export const Entry = Schema.define('Entry', Type.Object({ key: Type.String(), value: Type.String() }))
export const Done = Schema.define('Done', Type.Null())

export const Message = Schema.define('Message', Type.Object({ id: Type.String(), text: Type.String() }))
export const Messages = Schema.define('Messages', Type.Array(Message.schema))
export const Nothing = Schema.define('Nothing', Type.Object({}))
export const Draft = Schema.define('Draft', Type.Object({ text: Type.String() }))
/** Disabled is a value: the composer has no messaging to send through. */
export const Sent = Schema.define('Sent', Type.Union([
  Type.Object({ status: Type.Literal('sent'), id: Type.String() }),
  Type.Object({ status: Type.Literal('disabled') }),
]))

export const KeyValueStore = Interface.define('example.messenger.KeyValueStore', {
  get: Op.action('get', Key, MaybeValue),
  put: Op.action('put', Entry, Done),
})

export const Messaging = Interface.define('example.messenger.Messaging', {
  post: Op.action('post', Message, Done),
  messages: Op.event('messages', Message),
})

export const Inbox = Interface.define('example.messenger.Inbox', {
  receive: Op.action('receive', Message, Done),
  list: Op.action('list', Nothing, Messages),
})

export const Composer = Interface.define('example.messenger.Composer', {
  send: Op.action('send', Draft, Sent),
})

export const Outgoing = Schema.define('Outgoing', Type.Object({ contact: Type.String(), message: Type.String() }))
/** `send(contact, message)`: one pod, shared by every runtime it is placed in. */
export const Send = Interface.define('example.messenger.Send', { send: Op.action('send', Outgoing, Done) })
