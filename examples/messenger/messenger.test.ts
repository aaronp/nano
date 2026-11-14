/**
 * The messenger, end to end: alone, its widgets show disabled or fall back; with the `store` and `messaging` pods
 * registered into it too and plugged in (subscribed, each end chosen by a selector), messages flow and are stored;
 * unplugged, the inbox falls back again. The runtime's stream shows each message as it travels.
 *
 *   messenger:  inbox → store, composer → messaging, messaging.messages → inbox.receive
 *               (store also in `persistence`, messaging also in `messaging`)
 */
import { describe, expect, test } from 'bun:test'
import {
  createApplication, createRegistry, loadDoc, Pod, portKey, saveDoc, success,
  type Application, type NanoResult, type Runtime, type RuntimeEvent,
} from '@pritzlaff/nano'
import { Inbox, KeyValueStore, Messaging } from './interfaces.ts'
import { messengerProvider } from './providers.ts'

const INBOX = 'example.messenger/inbox#0', COMPOSER = 'example.messenger/composer#0', STORE = 'example.messenger/memory-store#0'
const MESSAGING = 'example.messenger/messaging#0'
const DOC = new URL('./nano.json', import.meta.url)

/** The value, or a thrown error: setup steps that must work. */
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
/** A pod made from one of the provider's implementations, registered in `rt`. */
const add = (rt: Runtime, implementation: string, config?: unknown) =>
  must(rt.register(Pod.create(messengerProvider.implementations.get(implementation)!, { config })))

/** What a host does when a person presses a button: call one of a pod's ops from outside. */
const send = (rt: Runtime, text: string) =>
  rt.call(COMPOSER).send({ text }) as Promise<NanoResult<{ status: 'sent'; id: string } | { status: 'disabled' }>>
const inbox = (rt: Runtime) => rt.call(INBOX).list({})
const stored = async (rt: Runtime) => {
  const r = await rt.call(STORE).get('inbox')
  return r.ok && typeof r.value === 'string' ? JSON.parse(r.value) : r
}

function registry() {
  const r = createRegistry()
  r.add(messengerProvider)
  return r
}

/** The messenger alone: nothing is wired, so the widgets show disabled or fall back. */
function openAlone() {
  const app = createApplication('app', { registry: registry() })
  const messenger = must(app.createRuntime('messenger'))
  add(messenger, 'example.messenger/inbox')
  add(messenger, 'example.messenger/composer')
  return { app, messenger }
}

/** Starts `persistence` and `messaging`, registers their pods into the messenger too, and plugs them in. */
function stitch(app: Application, messenger: Runtime) {
  const persistence = must(app.createRuntime('persistence')), messaging = must(app.createRuntime('messaging'))
  add(persistence, 'example.messenger/memory-store')
  add(messaging, 'example.messenger/messaging')
  must(messenger.register(persistence.pod(STORE)!))
  must(messenger.register(messaging.pod(MESSAGING)!))
  must(messenger.subscribe({ id: 'inbox-store', kind: 'call', from: { coord: INBOX }, to: { implements: KeyValueStore.coord } }))
  must(messenger.subscribe({ id: 'composer-messaging', kind: 'call', from: { coord: COMPOSER }, to: { implements: Messaging.coord } }))
  must(messenger.subscribe({
    id: 'messages-inbox', kind: 'event',
    from: { implements: Messaging.coord }, source: portKey(Messaging.coord, Messaging.ops.messages.coord),
    to: { coord: INBOX }, target: portKey(Inbox.coord, Inbox.ops.receive.coord),
  }))
  return { persistence }
}

function stitched() {
  const { app, messenger } = openAlone()
  return { app, messenger, ...stitch(app, messenger) }
}

describe('the messenger, alone', () => {
  test('the composer reports disabled, as a value', async () => {
    const { messenger } = openAlone()
    expect(await send(messenger, 'hi')).toEqual(success({ status: 'disabled' }))
  })

  test('the inbox keeps what it receives in its own fallback', async () => {
    const { messenger } = openAlone()
    await messenger.call(INBOX).receive({ id: 'm1', text: 'hi' })
    expect(await inbox(messenger)).toEqual(success([{ id: 'm1', text: 'hi' }]))
  })
})

describe('the messenger, stitched', () => {
  test('messages flow to the inbox and are stored in persistence', async () => {
    const { messenger, persistence } = stitched()
    const events: RuntimeEvent[] = []
    messenger.listen(e => events.push(e))
    const sent = await send(messenger, 'hi')
    if (!sent.ok || sent.value.status !== 'sent') throw new Error('not sent')
    // The stream shows the path: the host's call (no subscription), the post, its delivery to the inbox, and the inbox reading and writing the store.
    expect(events.flatMap(e => (e.type === 'sent' ? [e.subscription] : []))).toEqual([undefined, 'composer-messaging', 'messages-inbox', 'inbox-store', 'inbox-store'])
    expect(events.filter(e => e.type === 'delivered').every(e => e.result.ok)).toBe(true)
    const message = { id: sent.value.id, text: 'hi' }
    expect(await inbox(messenger)).toEqual(success([message]))
    expect(await stored(persistence)).toEqual([message])
  })

  test('unplugging the store sends the inbox back to its fallback', async () => {
    const { messenger, persistence } = stitched()
    await send(messenger, 'first')
    const events: RuntimeEvent[] = []
    messenger.listen(e => events.push(e))
    expect(messenger.unsubscribe('inbox-store')).toEqual(success(undefined))
    expect(events).toEqual([{ type: 'subscription-removed', id: 'inbox-store', reason: 'unsubscribed' }])
    const sent = await send(messenger, 'second')
    if (!sent.ok || sent.value.status !== 'sent') throw new Error('not sent')
    expect(await inbox(messenger)).toEqual(success([{ id: sent.value.id, text: 'second' }]))
    expect(await stored(persistence)).toMatchObject([{ text: 'first' }])
  })

  test('the committed nano.json is what saving writes, and loading it gives a working messenger', async () => {
    const doc = saveDoc(stitched().app, { title: 'Messenger' })
    if (process.env.NANO_WRITE) await Bun.write(DOC, JSON.stringify(doc, null, 2) + '\n')
    const committed = await Bun.file(DOC).json()
    expect(committed).toEqual(doc)

    const { app, notes } = await loadDoc(committed, { registry: registry() })
    expect(notes).toEqual([])
    const messenger = app.runtime('messenger')!
    const sent = await send(messenger, 'hi')
    expect(sent).toMatchObject({ ok: true, value: { status: 'sent' } })
    expect(await stored(app.runtime('persistence')!)).toMatchObject([{ text: 'hi' }])
  })
})
