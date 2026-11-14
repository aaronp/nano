/**
 * Sharing is registering (spec: "The pod is the effect boundary", behaviour 6). The `send` pod is wired to a private
 * `db` in `messaging`, and the same pod is registered in `chat` and `support`, so both have `send(contact, message)`.
 * Its database call travels through `messaging`'s subscription; `db` is never registered in `chat` or `support`.
 *
 *   messaging:  send → db        chat:  send        support:  send
 */
import { describe, expect, test } from 'bun:test'
import { createRegistry, createRuntime, Pod, success, type Runtime, type RuntimeEvent } from '@pritzlaff/nano'
import { messengerProvider, send } from './providers.ts'

const runtime = (id: string) => {
  const registry = createRegistry()
  registry.add(messengerProvider)
  const rt = createRuntime(id, { registry })
  const events: RuntimeEvent[] = []
  rt.listen(e => events.push(e))
  return { rt, events }
}
const reg = (rt: Runtime, pod: Pod): string => { const r = rt.register(pod); if (!r.ok) throw new Error(r.fail.reason); return r.value }
const sentTo = (events: RuntimeEvent[]) => events.filter(e => e.type === 'sent').map(e => e.to)

describe('send, shared', () => {
  test('given send wired to db in messaging and registered in chat and support, when chat sends, then chat records the send, messaging records the db call, and chat cannot reach db', async () => {
    const messaging = runtime('messaging'), chat = runtime('chat'), support = runtime('support')
    const db = reg(messaging.rt, Pod.create(messengerProvider.implementations.get('example.messenger/memory-store')!))
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
