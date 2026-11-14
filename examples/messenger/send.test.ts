/**
 * Sharing is placing (spec behaviour 7). The `send` pod is wired to a private `db` in `messaging`, and the same pod
 * is placed in `chat` and `support`, so both have `send(contact, message)`. Its database call travels through
 * `messaging`'s subscription; `db` is never placed in `chat` or `support`.
 *
 *   messaging:  send → db        chat:  send        support:  send
 */
import { describe, expect, test } from 'bun:test'
import { Application, createRegistry, Pod, success, type AppEvent } from '@pritzlaff/nano'
import { messengerProvider, send } from './providers.ts'

const sent = (events: AppEvent[], runtime: string) => events.flatMap(e => (e.type === 'sent' && e.runtime === runtime ? [`${e.from}->${e.to}`] : []))

describe('send, shared', () => {
  test('given send wired to db in messaging and placed in chat and support, when chat sends, then chat records the send, messaging records the db call, and chat cannot reach db', async () => {
    const registry = createRegistry()
    registry.add(messengerProvider)
    const r = await Application.create({
      pods: { send: Pod.lazy(send), db: Pod.lazy(messengerProvider.implementations.get('example.messenger/memory-store')!) },
      runtimes: {
        messaging: { pods: ['send', 'db'], subscriptions: [{ kind: 'call', from: 'send', to: 'db' }] },
        chat: { pods: ['send'], subscriptions: [] },
        support: { pods: ['send'], subscriptions: [] },
      },
    }, { registry })
    if (!r.ok) throw new Error(r.fail.reason)
    const app = r.value, events: AppEvent[] = []
    app.listen(e => events.push(e))
    expect(Object.entries(app.deployment().runtimes).filter(([, rt]) => rt.pods.includes('send')).map(([id]) => id)).toEqual(['messaging', 'chat', 'support'])

    expect(await app.call('chat', 'send').send({ contact: 'ann', message: 'hi' })).toEqual(success(null))
    expect(await app.call('support', 'send').send({ contact: 'bob', message: 'yo' })).toEqual(success(null))
    expect(sent(events, 'chat')).toEqual(['host->send'])
    expect(sent(events, 'support')).toEqual(['host->send'])
    expect(sent(events, 'messaging')).toEqual(['send->db', 'send->db'])
    expect(await app.call('messaging', 'db').get('ann')).toEqual(success('hi'))

    expect(await app.call('chat', 'db').get('ann')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    // Nothing in chat ever reached db: its only message is the host's send.
    expect(sent(events, 'chat')).toEqual(['host->send'])
  })
})
