/**
 * The messenger's contracts: a key-value store, a messaging channel, and the inbox and composer widgets that use them.
 *
 *   const kv = ctx.one(KeyValueStore)               // NanoResult<Client>: kv.value.put({ key: 'inbox', value: '[]' })
 *   if (ctx.all(Messaging).length === 0) …          // nothing wired: the composer is disabled
 */
import { Type } from 'typebox'
import { defineSchema, iface, op } from '@pritzlaff/nano'

export const Key = defineSchema('Key', Type.String())
export const MaybeValue = defineSchema('MaybeValue', Type.Union([Type.String(), Type.Null()]))
export const Entry = defineSchema('Entry', Type.Object({ key: Type.String(), value: Type.String() }))
export const Done = defineSchema('Done', Type.Null())

export const Message = defineSchema('Message', Type.Object({ id: Type.String(), text: Type.String() }))
export const Messages = defineSchema('Messages', Type.Array(Message.schema))
export const Nothing = defineSchema('Nothing', Type.Object({}))
export const Draft = defineSchema('Draft', Type.Object({ text: Type.String() }))
/** Disabled is a value: the composer has no messaging to send through. */
export const Sent = defineSchema('Sent', Type.Union([
  Type.Object({ status: Type.Literal('sent'), id: Type.String() }),
  Type.Object({ status: Type.Literal('disabled') }),
]))

export const KeyValueStore = iface('example.messenger.KeyValueStore', {
  get: op.action('get', Key, MaybeValue),
  put: op.action('put', Entry, Done),
})

export const Messaging = iface('example.messenger.Messaging', {
  post: op.action('post', Message, Done),
  messages: op.event('messages', Message),
})

export const Inbox = iface('example.messenger.Inbox', {
  receive: op.action('receive', Message, Done),
  list: op.action('list', Nothing, Messages),
})

export const Composer = iface('example.messenger.Composer', {
  send: op.action('send', Draft, Sent),
})

export const Outgoing = defineSchema('Outgoing', Type.Object({ contact: Type.String(), message: Type.String() }))
/** `send(contact, message)`: one pod, shared by every runtime it is placed in. */
export const Send = iface('example.messenger.Send', { send: op.action('send', Outgoing, Done) })
