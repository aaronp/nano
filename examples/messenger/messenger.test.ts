/**
 * The messenger, end to end: opened alone its widgets show disabled or fall back; with `persistence` and `messaging`
 * placed into it and subscribed, messages flow and are stored; unplugged, the inbox falls back again.
 *
 *   messenger:  inbox → store, composer → messaging, messaging.messages → inbox.receive
 *               (store placed from `persistence`, messaging from `messaging`)
 */
import { describe, expect, test } from 'bun:test'
import { createApplication, createRegistry, loadDoc, parseInstance, portKey, saveDoc, success, type Application, type Interface, type NanoResult, type Op, type Runtime } from '@pritzlaff/nano'
import { Composer, Inbox, KeyValueStore, Messaging } from './interfaces.ts'
import { messengerProvider } from './providers.ts'

const INBOX = 'inbox#0', COMPOSER = 'composer#0'
const STORE = 'store#0', MESSAGING = 'messaging#0'
const DOC = new URL('./nano.json', import.meta.url)

/** What a host does when a person presses a button: call one of an instance's ops from outside. */
const press = (rt: Runtime, coord: string, i: Interface, o: Op, input: unknown) => rt.record(parseInstance(coord)!.pod)!.instances.get(coord)!.host!.invoke(portKey(i.coord, o.coord), input)
const send = (rt: Runtime, text: string) =>
  press(rt, COMPOSER, Composer, Composer.ops.send, { text }) as Promise<NanoResult<{ status: 'sent'; id: string } | { status: 'disabled' }>>
const inbox = (rt: Runtime) => press(rt, INBOX, Inbox, Inbox.ops.list, {})
const stored = async (rt: Runtime) => {
  const r = await press(rt, STORE, KeyValueStore, KeyValueStore.ops.get, 'inbox')
  return r.ok && typeof r.value === 'string' ? JSON.parse(r.value) : r
}

function registry() {
  const r = createRegistry()
  r.add(messengerProvider)
  return r
}

/** The messenger alone: `create` never provisions unless asked (decision 24), so nothing is made for the widgets. */
async function openAlone() {
  const app = createApplication('app', { registry: registry() })
  const rt = app.createRuntime('messenger')
  if (!rt.ok) throw new Error(rt.fail.reason)
  await rt.value.create('inbox', 'example.messenger/inbox')
  await rt.value.create('composer', 'example.messenger/composer')
  return { app, messenger: rt.value }
}

/** Opens `persistence` and `messaging`, places their instances into the messenger, and plugs them in. */
async function stitch(app: Application, messenger: Runtime) {
  const persistence = app.createRuntime('persistence'), messaging = app.createRuntime('messaging')
  if (!persistence.ok || !messaging.ok) throw new Error('runtimes')
  await persistence.value.create('store', 'example.messenger/memory-store')
  await messaging.value.create('messaging', 'example.messenger/messaging')
  app.place('store', 'persistence', 'messenger')
  app.place('messaging', 'messaging', 'messenger')
  messenger.subscribe({ id: 'inbox-store', kind: 'call', from: INBOX, to: STORE })
  messenger.subscribe({ id: 'composer-messaging', kind: 'call', from: COMPOSER, to: MESSAGING })
  messenger.subscribe({
    id: 'messages-inbox', kind: 'event',
    from: MESSAGING, source: portKey(Messaging.coord, Messaging.ops.messages.coord),
    to: INBOX, target: portKey(Inbox.coord, Inbox.ops.receive.coord),
  })
  return { persistence: persistence.value }
}

async function stitched() {
  const { app, messenger } = await openAlone()
  return { app, messenger, ...(await stitch(app, messenger)) }
}

describe('the messenger, alone', () => {
  test('the composer reports disabled, as a value', async () => {
    const { messenger } = await openAlone()
    expect(await send(messenger, 'hi')).toEqual(success({ status: 'disabled' }))
  })

  test('the inbox keeps what it receives in its own fallback', async () => {
    const { messenger } = await openAlone()
    await press(messenger, INBOX, Inbox, Inbox.ops.receive, { id: 'm1', text: 'hi' })
    expect(await inbox(messenger)).toEqual(success([{ id: 'm1', text: 'hi' }]))
  })
})

describe('the messenger, stitched', () => {
  test('messages flow to the inbox and are stored in persistence', async () => {
    const { messenger, persistence } = await stitched()
    const sent = await send(messenger, 'hi')
    if (!sent.ok || sent.value.status !== 'sent') throw new Error('not sent')
    const message = { id: sent.value.id, text: 'hi' }
    expect(await inbox(messenger)).toEqual(success([message]))
    expect(await stored(persistence)).toEqual([message])
  })

  test('unplugging the store sends the inbox back to its fallback', async () => {
    const { messenger, persistence } = await stitched()
    await send(messenger, 'first')
    expect(messenger.unsubscribe('inbox-store')).toEqual(success(undefined))
    const sent = await send(messenger, 'second')
    if (!sent.ok || sent.value.status !== 'sent') throw new Error('not sent')
    expect(await inbox(messenger)).toEqual(success([{ id: sent.value.id, text: 'second' }]))
    expect(await stored(persistence)).toMatchObject([{ text: 'first' }])
  })

  test('the committed nano.json is what saving writes, and loading it gives a working messenger', async () => {
    const doc = saveDoc((await stitched()).app, { title: 'Messenger' })
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
