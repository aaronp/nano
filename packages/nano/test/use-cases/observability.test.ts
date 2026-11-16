/**
 * Use case 4 (spec: 2026-11-16-runtime-view-streams-design.md): `app.runtime(id).listen(fn)` is the one stream filtered
 * to that runtime; `app.listen` stays the operator's stream.
 */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { AppDeployment, Application, Implementation, Interface, Op, Provider, Registry, type AppEvent, type NanoResult } from '../../src/index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const Todos = Interface.define('acme.Todos', { add: Op.action(Type.String(), Type.Null()) })
const Store = Interface.define('acme.Store', { put: Op.action(Type.String(), Type.Null()) })
const Host = Interface.define('acme.HostSide', { ping: Op.action(Type.Null(), Type.Null()) })
const registry = Registry.create()
must(registry.add(Provider.define('acme', [
  Implementation.define('acme/todos', { provides: [Todos], make: () => ({ async add() {} }) }),
  Implementation.define('acme/todos-b', { provides: [Todos], dependencies: { store: Store }, make: ctx => ({ async add(t: string) { await must(ctx.one(Store)).call.put(t) } }) }),
  Implementation.define('acme/store', { provides: [Store], make: () => ({ async put() {} }) }),
  Implementation.define('acme/hostside', { provides: [Host], make: () => ({ async ping() {} }) }),
])))
const d: AppDeployment = {
  pods: { todos: { implementation: 'acme/todos', eager: true }, btodos: { implementation: 'acme/todos-b', eager: true }, store: { implementation: 'acme/store', eager: true }, shared: { implementation: 'acme/hostside', eager: true } },
  runtimes: {
    frontend: { pods: ['todos', 'shared'], subscriptions: [], exports: ['acme.Todos'] },
    backend: { pods: ['btodos', 'store', 'shared'], subscriptions: [{ kind: 'call', from: 'btodos', to: 'store' }] },
  },
}
const open = async () => must(await Application.create(must(AppDeployment.assemble(d, registry)), {}))

test("frontend's listen sees todos → host traffic, not backend's todos → store", async () => {
  const app = await open()
  const front: AppEvent[] = [], back: AppEvent[] = []
  app.runtime('frontend').listen(e => front.push(e))
  app.runtime('backend').listen(e => back.push(e))
  await app.runtime('frontend').get(Todos).add('milk')
  const sent = (es: AppEvent[]) => es.filter(e => e.type === 'sent').map(e => e.type === 'sent' ? `${e.from}>${e.to}` : '')
  expect(sent(front)).toEqual(['host>todos'])
  expect(front.some(e => e.type === 'delivered')).toBe(true)
  expect(sent(back)).toEqual([])
  await app.runtime('backend').get(Todos).add('eggs')
  expect(sent(front)).toEqual(['host>todos'])
  expect(sent(back)).toEqual(['host>btodos', 'btodos>store'])
})

test('each runtime sees the lifecycle of a pod placed in both', async () => {
  const app = await open()
  const front: AppEvent[] = [], back: AppEvent[] = []
  app.runtime('frontend').listen(e => front.push(e))
  app.runtime('backend').listen(e => back.push(e))
  must(await app.restart('shared'))
  for (const es of [front, back]) expect(es.filter(e => e.type === 'restarted' || e.type === 'closed' || e.type === 'built').every(e => 'pod' in e && e.pod === 'shared')).toBe(true)
  expect(front.some(e => e.type === 'restarted')).toBe(true)
  expect(back.some(e => e.type === 'restarted')).toBe(true)
  must(await app.restart('store'))
  expect(front.some(e => 'pod' in e && e.pod === 'store')).toBe(false)
  expect(back.some(e => 'pod' in e && e.pod === 'store')).toBe(true)
})

test('app.listen still sees everything', async () => {
  const app = await open()
  const all: AppEvent[] = []
  app.listen(e => all.push(e))
  await app.runtime('frontend').get(Todos).add('milk')
  expect(all.filter(e => e.type === 'sent').length).toBe(1)
})
