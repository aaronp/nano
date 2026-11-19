/**
 * A chat participant over the Messaging API, and nothing lower: it is written to `MessagingDef.Messaging` alone, so
 * it never knows a store exists. In nano it lives in `example.chat.room` and reaches `messaging` in `example.chat.backend` through its edge.
 */
import { Implementation } from '@pritzlaff/nano-core'
import { MessagingDef } from '../messaging/contract.ts'
import { ChatDef } from './contract.ts'

const ROOM = 'general'

const participant = Implementation.define(ChatDef.ns.implementationId('participant'), {
  provides: [ChatDef.api],
  description: 'One participant in the general room, named by its pod.',
  dependencies: { messaging: MessagingDef.api },
  calls: { say: { messaging: [MessagingDef.api.ops.post] }, transcript: { messaging: [MessagingDef.api.ops.history] } },
  make: ctx => ({
    async say(text, c) { return c.deps.messaging.post({ room: ROOM, from: ctx.self, text }) },
    async transcript(_, c) { return c.deps.messaging.history({ room: ROOM }) },
    async *lines() { for await (const m of ctx.deps.messaging.messages()) if (m.room === ROOM) yield m },
  }),
})

export const impls = { participant }
export default ChatDef.ns.provider([participant])
