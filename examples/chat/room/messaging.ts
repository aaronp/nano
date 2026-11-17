/**
 * A chat participant over the Messaging API, and nothing lower: it is written to `MessagingDef.Messaging` alone, so
 * it never knows a store exists. In nano it lives in `example.chat.room` and reaches `messaging` in `example.chat.backend` through its edge.
 */
import { MessagingDef } from '../messaging/contract.ts'
import { ChatDef } from './contract.ts'

const ROOM = 'general'

const participant = ChatDef.api.impl(ChatDef.ns.implementationId('participant'))
  .description('One participant in the general room, named by its pod.')
  .needs({ messaging: MessagingDef.api })
  .make(ctx => ({
    async say(text) { return ctx.deps.messaging.post({ room: ROOM, from: ctx.self, text }) },
    async transcript() { return ctx.deps.messaging.history({ room: ROOM }) },
    async *lines() { for await (const m of ctx.deps.messaging.messages()) if (m.room === ROOM) yield m },
  }))

export const impls = { participant }
export default ChatDef.ns.provider([participant])
