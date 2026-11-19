/**
 * The chat case study: the App Gateway pattern. `example.chat.backend` keeps the store and the Messaging API over it; `example.chat.room` keeps
 * two participants, written to the Messaging API alone. Their calls and subscriptions travel in `example.chat.backend`, let in by
 * its rules; nothing in `example.chat.room`, and not the host, can reach the store.
 */
import { expect, test } from 'bun:test'
import { Application, AppDeployment, Registry, port, type AppEvent, type NanoResult } from '@pritzlaff/nano-core'
import { KeyValueStoreDef } from '../kv/contract.ts'
import kv, { impls as kvImpls } from '../kv/memory.ts'
import { chatDeployment } from './deployment.ts'
import { MessagingDef } from './messaging/contract.ts'
import messaging from './messaging/kv.ts'
import { ChatDef } from './room/contract.ts'
import chat from './room/messaging.ts'

const KV = KeyValueStoreDef.api
const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const registry = Registry.create()
for (const p of [kv, messaging, chat]) must(registry.add(p))
const open = async (d = chatDeployment(registry)) => must(await Application.create(must(AppDeployment.assemble(d, registry))))
const failOf = (f: () => unknown) => { try { f(); return undefined } catch (e) { return (e as { fail?: { type: string } }).fail?.type } }

test('code gives the checked-in nano.json, and loading it runs the same app', async () => {
  expect(chatDeployment(registry)).toEqual(await Bun.file(new URL('./nano.json', import.meta.url)).json())
  const app = await Application.load(new URL('./nano.json', import.meta.url))
  expect((await app.runtime('example.chat.room').get(ChatDef.api, { pod: 'alice' }).say('loaded')).text).toBe('loaded')
})

test('participants chat through the Messaging API: what alice says, bob reads, and bob hears it live', async () => {
  const app = await open(), room = app.runtime('example.chat.room')
  const alice = room.get(ChatDef.api, { pod: 'alice' }), bob = room.get(ChatDef.api, { pod: 'bob' })
  await bob.transcript()                                // builds bob, and messaging's source over the store
  const lines = bob.lines()[Symbol.asyncIterator]()     // connected here
  await alice.say('hi bob')
  expect(await lines.next()).toMatchObject({ value: { from: 'alice', text: 'hi bob' } })
  await bob.say('hi alice')
  expect((await alice.transcript()).map(m => `${m.from}: ${m.text}`)).toEqual(['alice: hi bob', 'bob: hi alice'])
  await lines.return!()
})

test('the gateway: chat\'s calls travel in backend; chat\'s own stream shows only its participants being reached', async () => {
  const app = await open()
  const back: string[] = [], front: string[] = []
  const line = (e: AppEvent) => e.type === 'sent' && e.kind === 'call' ? `${e.from}→${e.to}` : undefined
  app.runtime('example.chat.backend').listen(e => { const l = line(e); if (l) back.push(l) })
  app.runtime('example.chat.room').listen(e => { const l = line(e); if (l) front.push(l) })
  await app.runtime('example.chat.room').get(ChatDef.api, { pod: 'alice' }).say('hello')
  expect(back).toEqual(['alice→messaging', 'messaging→chatStore'])
  expect(front).toEqual(['host→alice'])
})

test('nothing in chat can reach the store: not by resolving, and not by an edge added by hand without a rule', async () => {
  const app = await open()
  expect(app.runtime('example.chat.room').resolve(KeyValueStoreDef.api)).toMatchObject({ ok: false, reason: 'not-found' })   // not placed there
  const d = chatDeployment(registry)
  d.pods.mallory = { implementation: 'example.messaging/kv', eager: false }   // a messaging pod in chat, wired straight to the store
  d.runtimes['example.chat.room']!.pods.push('mallory')
  d.runtimes['example.chat.backend']!.subscriptions.push({ kind: 'call', from: 'mallory', to: 'chatStore' })
  must(await app.apply(d))
  await expect(app.runtime('example.chat.room').get(MessagingDef.api).post({ room: 'general', from: 'mallory', text: 'x' }))
    .rejects.toMatchObject({ fail: { type: 'denied' } })
})

test('the host holds no rule in backend: it can reach neither the Messaging API nor the store there', async () => {
  const app = await open(), backend = app.runtime('example.chat.backend')
  expect(failOf(() => backend.get(MessagingDef.api))).toBe('denied')
  expect(failOf(() => backend.get(KeyValueStoreDef.api))).toBe('denied')
})

test('swapping the store behind the gateway: the participants don\'t change, and the next message lands in the new store', async () => {
  const app = await open(), alice = app.runtime('example.chat.room').get(ChatDef.api, { pod: 'alice' })
  await alice.say('before')
  const next = app.deployment()
  next.pods.chatStore = { implementation: String(kvImpls.backup), eager: false }
  must(await app.apply(next))
  await alice.say('after')
  expect((await alice.transcript()).map(m => m.text)).toEqual(['after'])   // a fresh store: only what came after
})

test('declared op to op: alice.say → messaging.post → chatStore.put, one correlation, each call caused by the one before', async () => {
  const app = await open(), calls: Extract<AppEvent, { type: 'sent' }>[] = []
  app.listen(e => { if (e.type === 'sent' && e.kind === 'call') calls.push(e) })
  await app.runtime('example.chat.room').get(ChatDef.api, { pod: 'alice' }).say('hello')
  const say = calls.find(c => c.port === port(ChatDef.api, ChatDef.api.ops.say))!, post = calls.find(c => c.port === port(MessagingDef.api, MessagingDef.api.ops.post))!
  const put = calls.find(c => c.port === port(KV, KV.ops.put))!
  expect(post.cause).toBe(say.id)
  expect(put.cause).toBe(post.id)
  expect(new Set([say, post, put].map(c => c.correlation)).size).toBe(1)
  expect(messaging.implementations.get('example.messaging/kv')!.calls).toEqual({ post: ['store.put'], history: ['store.list'] })
})
