/**
 * The `example.messenger` provider: an in-memory key-value store, a messaging channel, and two widgets that adapt to
 * what is plugged in: the inbox falls back to a local map without a store, the composer reports itself disabled.
 *
 *   registry.add(messengerProvider)
 *   { pods: { inbox: Pod.lazy(inbox) }, runtimes: { messenger: { pods: ['inbox'], subscriptions: [] } } }   // works alone, on its fallback
 */
import { implementation, provide, provider, success } from '@pritzlaff/nano-core'
import { Composer, Inbox, KeyValueStore, Messaging, Send } from './interfaces.ts'

type Message = { id: string; text: string }

const memoryStore = implementation('example.messenger/memory-store', {
  provides: [KeyValueStore],
  make: () => {
    const data = new Map<string, string>()
    return [provide(KeyValueStore, {
      get: async key => success(data.get(key) ?? null),
      put: async ({ key, value }) => { data.set(key, value); return success(null) },
    })]
  },
})

/** Whatever is posted is passed on to every subscriber of `messages`. */
const messaging = implementation('example.messenger/messaging', {
  provides: [Messaging],
  make: ctx => [provide(Messaging, {
    async post(message) {
      await ctx.publish(Messaging.ops.messages, message)
      return success(null)
    },
  })],
})

/** Messages go to the store when one is plugged in, else to a local map: the documented fallback. */
const inbox = implementation('example.messenger/inbox', {
  provides: [Inbox],
  dependencies: { store: KeyValueStore },
  make: ctx => {
    const local = new Map<string, Message>()
    const unplugged = () => ctx.all(KeyValueStore).length === 0
    const stored = async () => {
      const r = await ctx.one(KeyValueStore).call.get('inbox')
      return r.ok ? success<Message[]>(r.value ? JSON.parse(r.value) : []) : r
    }
    return [provide(Inbox, {
      async receive(message) {
        if (unplugged()) { local.set(message.id, message); return success(null) }
        const all = await stored()
        if (!all.ok) return all
        return ctx.one(KeyValueStore).call.put({ key: 'inbox', value: JSON.stringify([...all.value, message]) })
      },
      list: async () => (unplugged() ? success([...local.values()]) : stored()),
    })]
  },
})

const composer = implementation('example.messenger/composer', {
  provides: [Composer],
  dependencies: { messaging: Messaging },
  make: ctx => [provide(Composer, {
    async send({ text }) {
      if (ctx.all(Messaging).length === 0) return success({ status: 'disabled' as const })
      const id = crypto.randomUUID()
      const r = await ctx.one(Messaging).call.post({ id, text })
      return r.ok ? success({ status: 'sent' as const, id }) : r
    },
  })],
})

/** Stores each message under its contact. Never names a runtime: the wiring decides which store. */
export const send = implementation('example.messenger/send', {
  provides: [Send],
  dependencies: { db: KeyValueStore },
  make: ctx => [provide(Send, { send: async ({ contact, message }) => {
    return ctx.one(KeyValueStore).call.put({ key: contact, value: message })
  } })],
})

export const messengerProvider = provider('example.messenger', [memoryStore, messaging, inbox, composer, send])
