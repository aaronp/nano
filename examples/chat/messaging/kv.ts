/**
 * Messaging over any key/value store, each message at `['rooms', room, id]`: plain TypeScript, plus a `messages()`
 * source built from the store's puts. In nano it reaches its store only through its call edge, in `example.chat.backend`.
 *
 *   const m = messaging(inMemory()); await m.post({ room: 'general', from: 'alice', text: 'hi' })
 */
import { Implementation } from '@pritzlaff/nano-core'
import { KeyValueStoreDef } from '../../kv/contract.ts'
import { MessagingDef } from './contract.ts'

type Message = MessagingDef.Message

/** Ids that sort in posting order, so `history` (ordered by path) is oldest first. */
const counter = () => { let n = 0; return () => String(++n).padStart(8, '0') }

export function messaging(store: KeyValueStoreDef.KeyValueStore, newId = counter()): Omit<MessagingDef.Messaging, 'messages'> {
  return {
    async post({ room, from, text }) { const m = { id: newId(), room, from, text }; await store.put({ key: ['rooms', room, m.id], value: m }); return m },
    // A cast: the store holds Json, and only messaging writes under ['rooms'], always a Message.
    async history({ room }) { return (await store.list({ prefix: ['rooms', room] })).map(e => e.value as Message) },
  }
}

// `Implementation.define`, not the builder: it declares `calls`. Each call builds `messaging` over its invocation's
// store, so the store call continues the chain of the op that made it.
const kv = Implementation.define(MessagingDef.ns.implementationId('kv'), {
  provides: [MessagingDef.api],
  description: 'Rooms of messages kept in whichever KeyValueStore its call edge reaches.',
  dependencies: { store: KeyValueStoreDef.api },
  calls: { post: { store: [KeyValueStoreDef.api.ops.put] }, history: { store: [KeyValueStoreDef.api.ops.list] } },
  make: ctx => {
    const newId = counter()
    return {
      post: (input, c) => messaging(c.deps.store, newId).post(input),
      history: (input, c) => messaging(c.deps.store, newId).history(input),
      async *messages() {
        const s = ctx.one(KeyValueStoreDef.api)
        if (s.ok) for await (const { input } of s.value.on(KeyValueStoreDef.api.ops.put)) if (input.key[0] === 'rooms') yield input.value as Message
      },
    }
  },
})

export const impls = { kv }
export default MessagingDef.ns.provider([kv])
