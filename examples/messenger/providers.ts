/**
 * The `example.messenger` provider: an in-memory key-value store, a messaging channel, and two widgets that adapt to
 * what is plugged in: the inbox falls back to a local map without a store, the composer reports itself disabled.
 *
 *   registry.add(messengerProvider)
 *   { pods: { inbox: Pod.lazy(inbox) }, runtimes: { messenger: { pods: ['inbox'], subscriptions: [] } } }   // works alone, on its fallback
 */
import { Coord, Implementation, provide, success } from '@pritzlaff/nano-core'
import { Composer, Inbox, KeyValueStore, Messaging, Send } from './interfaces.ts'

const ns = Coord.namespace('example.messenger')

type Message = { id: string; text: string }

const memoryStore = Implementation.define(ns.implementationId('memory-store'), {
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
const messaging = Implementation.define(ns.implementationId('messaging'), {
  provides: [Messaging],
  make: ctx => [provide(Messaging, {
    async post(message) {
      await ctx.publish(Messaging.ops.messages, message)
      return success(null)
    },
  })],
})

/** Messages go to the store when one is plugged in, else to a local map: the documented fallback. */
const inbox = Implementation.define(ns.implementationId('inbox'), {
  provides: [Inbox],
  dependencies: { store: KeyValueStore },
  make: ctx => {
    const local = new Map<string, Message>()
    const unplugged = () => ctx.all(KeyValueStore).length === 0
    const stored = async () => {
      const kv = ctx.one(KeyValueStore)
      if (!kv.ok) return kv
      const r = await kv.value.call.get('inbox')
      return r.ok ? success<Message[]>(r.value ? JSON.parse(r.value) : []) : r
    }
    return [provide(Inbox, {
      async receive(message) {
        if (unplugged()) { local.set(message.id, message); return success(null) }
        const all = await stored()
        if (!all.ok) return all
        const kv = ctx.one(KeyValueStore)
        return kv.ok ? kv.value.call.put({ key: 'inbox', value: JSON.stringify([...all.value, message]) }) : kv
      },
      list: async () => (unplugged() ? success([...local.values()]) : stored()),
    })]
  },
})

const composer = Implementation.define(ns.implementationId('composer'), {
  provides: [Composer],
  dependencies: { messaging: Messaging },
  make: ctx => [provide(Composer, {
    async send({ text }) {
      if (ctx.all(Messaging).length === 0) return success({ status: 'disabled' as const })
      const id = crypto.randomUUID()
      const m = ctx.one(Messaging)
      if (!m.ok) return m
      const r = await m.value.call.post({ id, text })
      return r.ok ? success({ status: 'sent' as const, id }) : r
    },
  })],
})

/** Stores each message under its contact. Never names a runtime: the wiring decides which store. */
export const send = Implementation.define(ns.implementationId('send'), {
  provides: [Send],
  dependencies: { db: KeyValueStore },
  make: ctx => [provide(Send, { send: async ({ contact, message }) => {
    const kv = ctx.one(KeyValueStore)
    return kv.ok ? kv.value.call.put({ key: contact, value: message }) : kv
  } })],
})

export const messengerProvider = ns.provider([memoryStore, messaging, inbox, composer, send])
