// The observer: op-level calls declared on the deployment/implementations, and those seen on the app's stream.
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { AppDeployment, Application, Implementation, Interface, Op, Provider, Registry } from '@pritzlaff/nano-core'
import { declaredOps, observeCalls, type OpCall } from '../src/observed-calls.ts'

const Str = Type.String()
const Front = Interface.define('acme.Front', { send: Op.action(Str, Str), later: Op.action(Str, Str) })
const Store = Interface.define('acme.Store', { save: Op.action(Str, Str), drop: Op.action(Str, Str) })
const registry = Registry.create()
registry.add(Provider.define('acme', [
  Implementation.define('acme/store', { provides: [Store], make: () => ({ async save(x: string) { return x }, async drop(x: string) { return x } }) }),
  Implementation.define('acme/front', { provides: [Front], dependencies: { store: Store }, calls: { send: { store: [Store.ops.save] } }, make: ({ deps }) => ({
    async send(x: string, c) { await c!.deps.store.save(x); return c!.deps.store.drop(x) },
    async later(x: string) { return deps.store.save(x) }, // the factory's deps, as a timer would: no cause
  }) }),
  Implementation.define('acme/plain', { provides: [Front], dependencies: { store: Store }, make: () => ({
    async send(x: string, c) { return c!.deps.store.save(x) }, async later(x: string) { return x } }) }),
]))
const tick = () => new Promise(r => setTimeout(r, 1))

async function make(front = 'acme/front', policy?: object) {
  const d = AppDeployment.assemble({
    pods: { front: { implementation: front, eager: false }, store: { implementation: 'acme/store', eager: false } },
    runtimes: { r: { pods: ['front', 'store'], subscriptions: [{ kind: 'call', from: 'front', to: 'store' }], ...(policy && { policy }) } },
  } as AppDeployment, registry)
  if (!d.ok) throw new Error(d.fail.reason)
  const a = await Application.create(d.value)
  if (!a.ok) throw new Error(a.fail.reason)
  return { app: a.value, obs: observeCalls(a.value, registry) }
}
const fromPods = (o: { calls(): OpCall[] }) => o.calls().filter(c => c.from !== 'host')
const save = { runtime: 'r', from: 'front', to: 'store', source: 'acme.Front/send', target: 'acme.Store/save' }

test('before any call: the declared pair, not seen', async () => {
  const { app } = await make()
  expect(declaredOps(app.deployment(), registry)).toEqual([{ ...save, declared: true, seen: false }])
  expect((await make()).obs.calls()).toEqual([{ ...save, declared: true, seen: false }])
})

test('after a send: save seen, drop seen but not declared; a factory call has no source; reconciled keeps the sourced pairs', async () => {
  const { app, obs } = await make()
  let heard = 0
  obs.listen(() => heard++)
  await app.call('r', 'front').send('a')
  await app.call('r', 'front').later('a')
  await tick()
  expect(fromPods(obs)).toEqual([
    { ...save, declared: true, seen: true },
    { ...save, target: 'acme.Store/drop', declared: false, seen: true },
    { ...save, source: null, declared: false, seen: true },
  ])
  expect(heard).toBeGreaterThan(0)
  const edge = obs.reconciled().runtimes.r!.subscriptions[0]
  expect(edge).toEqual({ kind: 'call', from: 'front', to: 'store', ops: [
    { source: 'acme.Front/send', target: 'acme.Store/save' }, { source: 'acme.Front/send', target: 'acme.Store/drop' }] })
  obs.stop()
})

test('host calls are listed, never reconciled', async () => {
  const { app, obs } = await make()
  await app.call('r', 'store').drop('a')
  expect(obs.calls()).toContainEqual({ runtime: 'r', from: 'host', to: 'store', source: null, target: 'acme.Store/drop', declared: false, seen: true })
  expect(obs.reconciled()).toEqual(app.deployment())
})

test('no ops and no calls: nothing until a call is seen', async () => {
  const { app, obs } = await make('acme/plain')
  expect(obs.calls()).toEqual([])
  await app.call('r', 'front').send('a')
  expect(fromPods(obs)).toEqual([{ ...save, declared: false, seen: true }])
})

test('nothing seen: reconciled is the deployment as it is', async () => {
  const { app, obs } = await make()
  expect(obs.reconciled()).toEqual(app.deployment())
})

test('a denied call is listed, not seen, never reconciled', async () => {
  const { app, obs } = await make('acme/plain', { kind: 'rules', rules: [{ allow: ['call'], from: 'host' }] })
  await app.call('r', 'front').send('a')
  expect(fromPods(obs)).toEqual([{ ...save, declared: false, seen: false }])
  expect(obs.reconciled()).toEqual(app.deployment())
})
