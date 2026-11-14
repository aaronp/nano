/**
 * The `example.messenger` provider: an in-memory key-value store, a messaging channel, and two widgets that adapt to
 * what is plugged in: the inbox falls back to a local map without a store, the composer reports itself disabled.
 *
 *   registry.add(messengerProvider)
 *   rt.register(Pod.create(inbox))   // works alone, on its fallback
 */
import { implementation, provide, provider, success, type NanoContext } from '@pritzlaff/nano'
import { Composer, Inbox, KeyValueStore, Messaging, Send } from './interfaces.ts'

type Message = { id: string; text: string }

const memoryStore = implementation('example.messenger/memory-store', {
  provides: [KeyValueStore],
  make: () => {
    const data = new Map<string, string>()
    return [provide(KeyValueStore, {
      get: async (_ctx, key) => success(data.get(key) ?? null),
      put: async (_ctx, { key, value }) => { data.set(key, value); return success(null) },
    })]
  },
})

/** Whatever is posted is passed on to every subscriber of `messages`. */
const messaging = implementation('example.messenger/messaging', {
  provides: [Messaging],
  make: () => [provide(Messaging, {
    async post(ctx, message) {
      await ctx.publish(Messaging.ops.messages, message)
      return success(null)
    },
  })],
})

/** Messages go to the store when one is plugged in, else to a local map: the documented fallback. */
const inbox = implementation('example.messenger/inbox', {
  provides: [Inbox],
  dependencies: { store: KeyValueStore },
  make: () => {
    const local = new Map<string, Message>()
    const stored = async (ctx: NanoContext) => {
      const r = await ctx.one(KeyValueStore, kv => kv.get('inbox'))
      return r.ok ? success<Message[]>(r.value ? JSON.parse(r.value) : []) : r
    }
    return [provide(Inbox, {
      async receive(ctx, message) {
        if (!ctx.hasDependencies('store')) { local.set(message.id, message); return success(undefined) }
        const all = await stored(ctx)
        if (!all.ok) return all
        const put = await ctx.one(KeyValueStore, kv => kv.put({ key: 'inbox', value: JSON.stringify([...all.value, message]) }))
        return put.ok ? success(undefined) : put
      },
      list: async ctx => (ctx.hasDependencies('store') ? stored(ctx) : success([...local.values()])),
    })]
  },
})

const composer = implementation('example.messenger/composer', {
  provides: [Composer],
  dependencies: { messaging: Messaging },
  make: () => [provide(Composer, {
    async send(ctx, { text }) {
      if (!ctx.hasDependencies('messaging')) return success({ status: 'disabled' as const })
      const id = crypto.randomUUID()
      const r = await ctx.one(Messaging, m => m.post({ id, text }))
      return r.ok ? success({ status: 'sent' as const, id }) : r
    },
  })],
})

/** Stores each message under its contact. Never names a runtime: the wiring decides which store. */
export const send = implementation('example.messenger/send', {
  provides: [Send],
  dependencies: { db: KeyValueStore },
  make: () => [provide(Send, { send: async (ctx, { contact, message }) =>
    ctx.one(KeyValueStore, kv => kv.put({ key: contact, value: message })) })],
})

export const messengerProvider = provider('example.messenger', [memoryStore, messaging, inbox, composer, send])
