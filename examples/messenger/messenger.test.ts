/**
 * The messenger, end to end: alone, its widgets show disabled or fall back; with the `store` and `messaging` pods
 * placed in it too and plugged in (an `apply` adding the pods and subscriptions), messages flow and are stored;
 * unplugged (an `apply` removing the subscription), the inbox falls back again. The stream shows each message as it
 * travels.
 *
 *   messenger:  inbox → store, composer → messaging, messaging.messages → inbox.receive
 *               (store also in `persistence`, messaging also in `messaging`)
 */
import { describe, expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, Pod, port, success, type AppEvent, type Application as App, type NanoResult } from '@pritzlaff/nano-core'
import { Composer, Inbox, Messaging } from './interfaces.ts'
import { messengerProvider } from './providers.ts'
import { observeCalls } from '../../packages/ui-workspace/src/observed-calls.ts'

const DOC = new URL('./nano.json', import.meta.url)

const pod = (name: string) => Pod.lazy(messengerProvider.implementations.get(`example.messenger/${name}`)!)

/** The messenger alone: nothing is wired, so the widgets show disabled or fall back. */
const ALONE: AppDeployment = {
  pods: { inbox: pod('inbox'), composer: pod('composer') },
  runtimes: { messenger: { pods: ['inbox', 'composer'], subscriptions: [] } },
}
const INBOX_STORE = { kind: 'call', from: 'inbox', to: 'store' } as const
/** `persistence` and `messaging` with their pods, placed in the messenger too and plugged in. */
const STITCHED: AppDeployment = {
  pods: { ...ALONE.pods, store: pod('memory-store'), messaging: pod('messaging') },
  runtimes: {
    messenger: {
      pods: ['inbox', 'composer', 'store', 'messaging'],
      subscriptions: [
        INBOX_STORE,
        { kind: 'call', from: 'composer', to: 'messaging' },
        { kind: 'pipe', from: 'messaging', source: port(Messaging, Messaging.ops.messages), to: 'inbox', target: port(Inbox, Inbox.ops.receive) },
      ],
    },
    persistence: { pods: ['store'], subscriptions: [] },
    messaging: { pods: ['messaging'], subscriptions: [] },
  },
}

/** What a host does when a person presses a button: call one of a pod's ops from outside. */
const send = (app: App, text: string) =>
  app.call('messenger', 'composer').send({ text }) as Promise<NanoResult<{ status: 'sent'; id: string } | { status: 'disabled' }>>
const inbox = (app: App) => app.call('messenger', 'inbox').list({})
const stored = async (app: App) => {
  const r = await app.call('persistence', 'store').get('inbox')
  return r.ok && typeof r.value === 'string' ? JSON.parse(r.value) : r
}

function registry() {
  const r = Registry.create()
  r.add(messengerProvider)
  return r
}
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

/** `d` assembled with a fresh registry and made live. */
const open = async (d: unknown, r = registry()) => must(await Application.create(must(AppDeployment.assemble(d, r)), {}))
const openAlone = () => open(ALONE)
/** Opened alone, then plugged in: the store and messaging are added and wired by one `apply`. */
async function stitched() {
  const app = await openAlone()
  must(await app.apply(STITCHED))
  return app
}

describe('the messenger, alone', () => {
  test('the composer reports disabled, as a value', async () => {
    expect(await send(await openAlone(), 'hi')).toEqual(success({ status: 'disabled' }))
  })

  test('the inbox keeps what it receives in its own fallback', async () => {
    const app = await openAlone()
    await app.call('messenger', 'inbox').receive({ id: 'm1', text: 'hi' })
    expect(await inbox(app)).toEqual(success([{ id: 'm1', text: 'hi' }]))
  })
})

describe('the messenger, stitched', () => {
  test('messages flow to the inbox and are stored in persistence', async () => {
    const app = await stitched()
    const events: AppEvent[] = []
    app.listen(e => events.push(e))
    const sent = await send(app, 'hi')
    if (!sent.ok || sent.value.status !== 'sent') throw new Error('not sent')
    // The stream shows the path, all in the messenger: the host's call, the post, its delivery to the inbox, and the inbox reading and writing the store.
    expect(events.flatMap(e => (e.type === 'sent' ? [`${e.runtime}: ${e.from}->${e.to}`] : []))).toEqual([
      'messenger: host->composer', 'messenger: composer->messaging', 'messenger: messaging->inbox', 'messenger: inbox->store', 'messenger: inbox->store',
    ])
    expect(events.filter(e => e.type === 'delivered').every(e => e.result.ok)).toBe(true)
    const message = { id: sent.value.id, text: 'hi' }
    expect(await inbox(app)).toEqual(success([message]))
    expect(await stored(app)).toEqual([message])
  })

  test('unplugging the store sends the inbox back to its fallback', async () => {
    const app = await stitched()
    await send(app, 'first')
    const events: AppEvent[] = []
    app.listen(e => events.push(e))
    const m = STITCHED.runtimes.messenger!
    expect(await app.apply({ ...STITCHED, runtimes: { ...STITCHED.runtimes, messenger: { ...m, subscriptions: m.subscriptions.filter(s => s !== INBOX_STORE) } } }))
      .toEqual(success(undefined))
    expect(events).toEqual([{ type: 'applied', caller: 'host', added: [], removed: [], changed: [], rewired: ['messenger'] }])
    const sent = await send(app, 'second')
    if (!sent.ok || sent.value.status !== 'sent') throw new Error('not sent')
    expect(await inbox(app)).toEqual(success([{ id: sent.value.id, text: 'second' }]))
    expect(await stored(app)).toMatchObject([{ text: 'first' }])
  })

  test('the committed nano.json is what saving writes, and it creates a working messenger', async () => {
    const saved = (await stitched()).deployment()
    if (process.env.NANO_WRITE) await Bun.write(DOC, JSON.stringify(saved, null, 2) + '\n')
    const committed = await Bun.file(DOC).json()
    expect(committed).toEqual(saved)

    const app = await open(committed)
    expect(await send(app, 'hi')).toMatchObject({ ok: true, value: { status: 'sent' } })
    expect(await stored(app)).toMatchObject([{ text: 'hi' }])
  })

  test('the post is caused by the composer\'s send, the store calls by the piped receive; every call in the flow is declared', async () => {
    const reg = registry(), app = await open(STITCHED, reg), o = observeCalls(app, reg), sent: Extract<AppEvent, { type: 'sent' }>[] = []
    app.listen(e => { if (e.type === 'sent') sent.push(e) })
    must(await send(app, 'hi'))
    const at = (p: string) => sent.filter(e => e.port === p)
    expect(at(port(Messaging, Messaging.ops.post))[0]!.cause).toBe(at(port(Composer, Composer.ops.send))[0]!.id)
    const receive = at(port(Inbox, Inbox.ops.receive))[0]!
    expect(sent.filter(e => e.to === 'store').map(e => e.cause)).toEqual([receive.id, receive.id])
    const made = o.calls().filter(c => c.seen && c.source !== null)
    expect(made.length).toBe(3)
    expect(made.filter(c => !c.declared)).toEqual([])
  })
})
