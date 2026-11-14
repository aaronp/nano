// @ts-nocheck — the effect-pod revision isn't built yet; remove when it lands
/**
 * Sharing is registering (spec: "The pod is the effect boundary", behaviour 6). The `send` pod is wired to a private
 * `db` in `messaging`, and the same pod is registered in `chat` and `support`, so both have `send(contact, message)`.
 * Its database call travels through `messaging`'s subscription; `db` is never registered in `chat` or `support`.
 *
 *   messaging:  send → db        chat:  send        support:  send
 *
 * The `Send` interface and implementation live here while the revision is todo; they move to interfaces.ts and
 * providers.ts when it lands.
 */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import * as nano from '@pritzlaff/nano'
import { createRegistry, createRuntime, defineSchema, iface, implementation, op, provide, provider, success, type RuntimeEvent } from '@pritzlaff/nano'
import { Done, KeyValueStore } from './interfaces.ts'
import { messengerProvider } from './providers.ts'

const { Pod } = nano as unknown as { Pod: { create(i: unknown, opts?: { config?: unknown }): any } }

const Outgoing = defineSchema('Outgoing', Type.Object({ contact: Type.String(), message: Type.String() }))
const Send = iface('example.messenger.Send', { send: op.action('send', Outgoing, Done) })

/** Stores each message under its contact. Never names a runtime: the wiring decides which store. */
const send = implementation('example.send/send', {
  provides: [Send],
  dependencies: { db: KeyValueStore },
  make: () => [provide(Send, { send: async (ctx, { contact, message }) =>
    ctx.one(KeyValueStore, kv => kv.put({ key: contact, value: message })) })],
})

const runtime = (id: string) => {
  const registry = createRegistry()
  registry.add(messengerProvider)
  registry.add(provider('example.send', [send]))
  const rt = createRuntime(id, { registry })
  const events: RuntimeEvent[] = []
  rt.listen(e => events.push(e))
  return { rt, events }
}
const reg = (rt, pod): string => { const r = rt.register(pod); if (!r.ok) throw new Error(r.fail.reason); return r.value }
const sentTo = (events: RuntimeEvent[]) => events.filter(e => e.type === 'sent').map(e => e.to)

describe('send, shared', () => {
  test.todo('given send wired to db in messaging and registered in chat and support, when chat sends, then chat records the send, messaging records the db call, and chat cannot reach db', async () => {
    const messaging = runtime('messaging'), chat = runtime('chat'), support = runtime('support')
    const db = reg(messaging.rt, Pod.create(messengerProvider.implementations.get('example.messenger/memory-store')))
    const pod = Pod.create(send)
    const home = reg(messaging.rt, pod)
    messaging.rt.subscribe({ kind: 'call', from: home, to: db })
    const inChat = reg(chat.rt, pod), inSupport = reg(support.rt, pod)
    expect(pod.runtimes).toEqual(['messaging', 'chat', 'support'])

    expect(await chat.rt.call(inChat).send({ contact: 'ann', message: 'hi' })).toEqual(success(null))
    expect(await support.rt.call(inSupport).send({ contact: 'bob', message: 'yo' })).toEqual(success(null))
    expect(sentTo(chat.events)).toEqual([inChat])
    expect(sentTo(support.events)).toEqual([inSupport])
    expect(sentTo(messaging.events)).toEqual([db, db])
    expect(await messaging.rt.call(db).get('ann')).toEqual(success('hi'))

    expect(await chat.rt.call(db).get('ann')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(JSON.stringify(chat.events)).not.toContain('memory-store')
  })
})
