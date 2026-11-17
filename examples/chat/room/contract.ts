/**
 * A chat room as one participant sees it: what the chat UI would be written against. Who the participant is, is the
 * pod's name; the room is `general`.
 *
 *   const alice = app.runtime('example.chat.room').get(ChatDef.api, { pod: 'alice' }); await alice.say('hi')
 */
import { Type } from 'typebox'
import { Coord, Interface, Op } from '@pritzlaff/nano-core'
import { MessagingDef } from '../messaging/contract.ts'

export namespace ChatDef {
  export const ns = Coord.namespace('example.chat')
  export const api = ns.interface('Chat', {
    say: Op.action(Type.String(), MessagingDef.Message),
    transcript: Op.action(Type.Null(), Type.Array(MessagingDef.Message)),
    /** Each line said in the room from now on, by anyone. */
    lines: Op.event(MessagingDef.Message),
  })
  export type Chat = Interface.Type<typeof api>
}
