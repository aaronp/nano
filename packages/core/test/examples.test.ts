// The core by example. Each test is a short story; read them in order.
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Components, err, Ops, Registries, RegistryOps, Runtimes, type Delta, type Policy, type Registry, type Subscription } from '../src'

const flush = () => new Promise(r => setTimeout(r, 0))
const me = (registry: string) => ({ registry, instance: 'test' })

// Ops are just names (plus schemas). A source publishes, a sink receives.
const Updated = Ops.source('com.acme', 'counter-updated', Type.Number())
const Inc = Ops.sink('com.acme', 'inc', Type.Null())
const Log = Ops.sink('com.acme', 'log', Type.Unknown())

/** A logger: plain array, one sink that appends to it. */
const logger = () => {
  const c = Components.create({ ns: 'com.acme', name: 'logger' }, () => [] as unknown[])
  c.action(Log, (lines, x) => { lines.push(x) })
  return Components.instantiate(c)
}
const logs = (reg: Registry, source: string, op: string, listener = 'log') => reg.subscribe({ source, op, listener, target: Ops.key(Log) })

test('lift a plain counter', async () => {
  // Ordinary code, untouched.
  let counter = 0
  const increment = () => { counter = counter + 1 }

  // The lift: how to make it, what `inc` does, and that `inc` emits `counter-updated` (read by its own action).
  const Counter = Components.create({ ns: 'com.acme', name: 'counter' }, () => ({ get: () => counter, increment }))
  Counter.action(Updated, c => c.get())
  Counter.action(Inc, c => { c.increment() }, { emits: [Updated] })

  const rt = Runtimes.create(Registries.create('r')), reg = rt.registry
  const log = logger()
  reg.add('counter', Components.instantiate(Counter)); reg.add('log', log)
  logs(reg, 'counter', Ops.key(Updated))

  await rt.call(me('r'), 'counter', Ops.key(Inc), null)
  await rt.call(me('r'), 'counter', Ops.key(Inc), null)
  expect(log.value).toEqual([1, 2])
  expect(counter).toBe(2)
})

test('watch a registry: its changes are events from the instance "registry"', async () => {
  const rt = Runtimes.create(Registries.create('r')), reg = rt.registry
  const watcher = logger(); reg.add('watcher', watcher)
  for (const op of Object.values(RegistryOps.deltas)) logs(reg, 'registry', Ops.key(op), 'watcher')
  await flush(); watcher.value.length = 0   // ignore the watcher's own setup

  const Extra = Ops.source('com.acme', 'extra', Type.String())
  const c = logger(); reg.add('c', c)                                   // instance-added
  const s = logs(reg, 'c', 'any/op', 'c') as { value: Subscription }    // subscription-opened
  c.env.register(Extra)                                                 // op-added
  reg.unsubscribe(s.value.id)                                           // subscription-closed
  reg.remove('c')                                                       // instance-removed
  await flush()
  expect((watcher.value as Delta[]).map(d => d.type)).toEqual(['instance-added', 'subscription-opened', 'op-added', 'subscription-closed', 'instance-removed'])
})

test('subscribe and unsubscribe at runtime by calling the registry', async () => {
  const rt = Runtimes.create(Registries.create('r')), reg = rt.registry
  const src = logger(), log = logger()
  src.env.register(Updated)
  reg.add('src', src); reg.add('log', log)
  const handle = log.env.handles()[0]!                                 // the logger's view of this registry

  const s = await handle.call('registry', RegistryOps.subscribe, { source: 'src', op: Ops.key(Updated), listener: 'log', target: Ops.key(Log) }) as { value: Subscription }
  await src.env.notify(Updated, 1)
  await handle.call('registry', RegistryOps.unsubscribe, s.value.id)
  await src.env.notify(Updated, 2)
  expect(log.value).toEqual([1])
})

test('one instance, two registries', async () => {
  const a = Runtimes.create(Registries.create('a')).registry, b = Runtimes.create(Registries.create('b')).registry
  const src = logger(); src.env.register(Updated)
  const logA = logger(), logB = logger()
  a.add('src', src); b.add('src', src); a.add('log', logA); b.add('log', logB)
  logs(a, 'src', Ops.key(Updated)); logs(b, 'src', Ops.key(Updated))

  await src.env.notify(Updated, 1)      // reaches both registries
  a.remove('src')
  await src.env.notify(Updated, 2)      // now only b
  expect([logA.value, logB.value]).toEqual([[1], [1, 2]])
})

test('a policy: components may only subscribe themselves', async () => {
  // A policy wraps a runtime. This one guards the registry's subscribe and unsubscribe.
  const selfOnly: Policy = inner => ({
    ...inner,
    call(from, target, op, arg) {
      const listener = target !== 'registry' ? from.instance
        : op === Ops.key(RegistryOps.subscribe) ? (arg as Subscription).listener
        : op === Ops.key(RegistryOps.unsubscribe) ? inner.registry.snapshot().subscriptions.find(s => s.id === arg)?.listener
        : from.instance
      return listener === from.instance ? inner.call(from, target, op, arg) : Promise.resolve(err(`${from.instance} may only subscribe itself`))
    },
  })
  const reg = Runtimes.create(Registries.create('r'), selfOnly).registry
  const src = logger(), log = logger(); src.env.register(Updated)
  reg.add('src', src); reg.add('log', log)
  const sub = (who: typeof log, listener: string) =>
    who.env.handles()[0]!.call('registry', RegistryOps.subscribe, { source: 'src', op: Ops.key(Updated), listener, target: Ops.key(Log) })

  expect(await sub(src, 'log')).toEqual(err('src may only subscribe itself'))
  expect('value' in await sub(log, 'log')).toBe(true)
})

test('register an op at runtime', async () => {
  const Born = Ops.source('com.acme', 'born', Type.String()), Later = Ops.source('com.acme', 'later', Type.String())
  const C = Components.create({ ns: 'com.acme', name: 'grower' }, env => { env.register(Born); return {} })   // before any registry
  const rt = Runtimes.create(Registries.create('r')), reg = rt.registry
  const watcher = logger(); reg.add('watcher', watcher)
  logs(reg, 'registry', 'composable/instance-added', 'watcher'); logs(reg, 'registry', 'composable/op-added', 'watcher')

  const g = Components.instantiate(C); reg.add('g', g)
  g.env.register(Later)
  await flush()
  expect(watcher.value).toEqual([
    { type: 'instance-added', instance: 'g', ops: ['com.acme/born'], component: 'com.acme/grower' },
    { type: 'op-added', instance: 'g', op: 'com.acme/later' },
  ])
})
