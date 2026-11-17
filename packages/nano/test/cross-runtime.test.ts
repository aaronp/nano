/** Call edges from another runtime (spec 2026-11-17-call-policy-design.md §4): calls travel where the edge is. */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { AppDeployment, Application, Implementation, Interface, Op, Pods, Provider, Registry, Runtime, type AppEvent, type Ask } from '../src/index.ts'

const Db = Interface.define('acme.Db', { save: Op.action(Type.String(), Type.Null()) })
const Go = Interface.define('acme.Go', { go: Op.action(Type.Null(), Type.Null()) })
const registry = Registry.create()
registry.add(Provider.define('acme', [
  Implementation.define('acme/db', { provides: [Db], make: () => ({ async save() {} }) }),
  Implementation.define('acme/caller', { provides: [Go], dependencies: { store: Db }, make: c => ({
    async go() { for (const s of c.all(Db)) await s.call.save('x') },
  }) }),
]))
const pods = { caller: { implementation: 'acme/caller', eager: false }, store: { implementation: 'acme/db', eager: false } }

async function app(runtimes: AppDeployment['runtimes']) {
  const asks: Ask[] = []
  const policy = { isAllowed: (a: Ask) => (asks.push(a), { approved: true as const }) }
  const d = AppDeployment.assemble({ pods, runtimes }, registry)
  if (!d.ok) throw new Error(d.fail.reason)
  const a = await Application.create(d.value, { policies: Object.fromEntries(Object.keys(runtimes).map(id => [id, policy])) })
  if (!a.ok) throw new Error(a.fail.reason)
  return { app: a.value, asks }
}

test('a call edge listed in another runtime: the call travels there, asked as outside', async () => {
  const { app: a, asks } = await app({
    chat: { pods: ['caller'], subscriptions: [] },
    backend: { pods: ['store'], subscriptions: [{ kind: 'call', from: 'caller', to: 'store' }] },
  })
  const chat: AppEvent[] = [], backend: AppEvent[] = []
  a.runtime('chat').listen(e => { chat.push(e) }); a.runtime('backend').listen(e => { backend.push(e) })
  expect((await a.call('chat', 'caller').go(null)).ok).toBe(true)
  expect(backend).toContainEqual(expect.objectContaining({ type: 'sent', runtime: 'backend', from: 'caller', to: 'store' }))
  expect(chat.some(e => e.type === 'sent' && e.from === 'caller')).toBe(false)
  expect(asks).toContainEqual(expect.objectContaining({ runtime: 'backend', kind: 'call', from: 'caller', to: 'store', outside: true }))
})

test('a pod placed in two runtimes is outside only where it is not placed', async () => {
  const { app: a, asks } = await app({
    chat: { pods: ['caller'], subscriptions: [] },
    backend: { pods: ['caller', 'store'], subscriptions: [{ kind: 'call', from: 'caller', to: 'store' }] },
    other: { pods: ['store'], subscriptions: [{ kind: 'call', from: 'caller', to: 'store' }] },
  })
  expect((await a.call('chat', 'caller').go(null)).ok).toBe(true)
  const calls = asks.filter(x => x.kind === 'call' && x.from === 'caller')
  expect(calls.map(x => [x.runtime, x.outside])).toEqual([['backend', false], ['other', true]])
})

test('a pipe from outside the runtime is refused by Runtime.create', () => {
  const scope = Pods.create(pods, { registry })
  if (!scope.ok) throw new Error(scope.fail.reason)
  const r = Runtime.create('b', { pods: ['store'], subscriptions: [{ kind: 'pipe', from: 'caller', source: 'acme.Go/go', to: 'store', target: 'acme.Db/save' }] }, scope.value)
  expect(r.ok).toBe(false)
  if (!r.ok) expect(r.fail.reason).toContain('caller is not placed here')
})

test('a call edge from a pod placed in no runtime is invalid-input', async () => {
  const d = AppDeployment.assemble({ pods, runtimes: { backend: { pods: ['store'], subscriptions: [{ kind: 'call', from: 'caller', to: 'store' }] } } }, registry)
  if (!d.ok) throw new Error(d.fail.reason)
  const a = await Application.create(d.value)
  expect(a.ok).toBe(false)
})
