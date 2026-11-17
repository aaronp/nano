/**
 * The messaging contract: rooms of messages. What the chat app (or anything else) writes to; it knows nothing of
 * where messages are kept.
 *
 *   const m: MessagingDef.Messaging = app.runtime('example.chat.backend').get(MessagingDef.api)
 *   await m.post({ room: 'general', from: 'alice', text: 'hi' }); for await (const msg of m.messages()) …
 */
import { Type, type Static } from 'typebox'
import { Coord, Interface, Op, Schema } from '@pritzlaff/nano-core'

export namespace MessagingDef {
  export const ns = Coord.namespace('example.messaging')

  export const Message = Schema.define(Type.Object({ id: Type.String(), room: Type.String(), from: Type.String(), text: Type.String() }))
  export type Message = Static<typeof Message>

  export const api = ns.interface('Messaging', {
    post: Op.action(Type.Object({ room: Type.String(), from: Type.String(), text: Type.String() }), Message),
    /** A room's messages, oldest first. */
    history: Op.action(Type.Object({ room: Type.String() }), Type.Array(Message)),
    /** Every message posted from now on, in any room. */
    messages: Op.event(Message),
  })
  export type Messaging = Interface.Type<typeof api>
}
