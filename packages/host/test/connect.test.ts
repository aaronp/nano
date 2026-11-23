// connect: a placed pod's dependency wired to the one pod providing it, as the chat example's nano.json wires it.
import { expect, test } from 'bun:test'
import { Registry, type AppDeployment } from '@pritzlaff/nano-core'
import kv from '../../../examples/kv/memory.ts'
import messaging from '../../../examples/chat/messaging/kv.ts'
import chat from '../../../examples/chat/index.ts'
import { connect } from '../src/index.ts'

const registry = Registry.create()
for (const p of [kv, messaging, chat]) registry.add(p)
const file = async (): Promise<AppDeployment> => Bun.file(new URL('../../../examples/chat/nano.json', import.meta.url)).json()

test("the chat example, alice's and bob's edges and rules taken out, auto-connects back to exactly the file", async () => {
  const want = await file(), d = structuredClone(want), back = d.runtimes['example.chat.backend']!
  back.subscriptions = back.subscriptions.filter(s => s.from === 'messaging')
  if (back.policy?.kind === 'rules') back.policy.rules = back.policy.rules.slice(2)
  const { deployment, notes } = connect(d, registry, ['alice', 'bob'])
  expect(deployment).toEqual(want)
  expect(notes).toEqual(['connected alice → messaging (example.messaging.Messaging)', 'connected bob → messaging (example.messaging.Messaging)'])
})

test('a dependency already met is left alone', async () => {
  expect(connect(await file(), registry, ['alice', 'messaging'])).toEqual({ deployment: await file(), notes: [] })
})

test('no pod placed: an implementation that could provide it is named, as no fault; none at all: nothing provides it', async () => {
  const none = structuredClone(await file())
  none.runtimes['example.chat.backend']!.subscriptions = []
  delete none.pods['messaging']; none.runtimes['example.chat.backend']!.pods = ['chatStore']
  expect(connect(none, registry, ['alice']).notes).toEqual(['alice needs example.messaging.Messaging: no pod yet (example.messaging/kv provides it)'])
  const bare = Registry.create(); for (const p of [kv, chat]) bare.add(p)
  expect(connect(none, bare, ['alice']).notes).toEqual(['alice needs example.messaging.Messaging: nothing provides it'])
})

test('no provider, or two, changes nothing and says so', async () => {
  const d = await file(), none = structuredClone(d)
  none.runtimes['example.chat.backend']!.subscriptions = []
  delete none.pods['messaging']; none.runtimes['example.chat.backend']!.pods = ['chatStore']
  expect(connect(none, registry, ['alice']).deployment).toEqual(none)
  const two = structuredClone(d)
  two.pods['messaging2'] = { implementation: 'example.messaging/kv', eager: false }
  two.runtimes['example.chat.room']!.pods.push('participant1', 'messaging2')
  two.pods['participant1'] = { implementation: 'example.chat/participant', eager: false }
  const r = connect(two, registry, ['participant1'])
  expect(r.deployment).toEqual(two)
  expect(r.notes).toEqual(['participant1 needs example.messaging.Messaging: messaging, messaging2 all provide it; wire one in Connections'])
})
