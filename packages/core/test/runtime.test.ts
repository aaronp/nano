import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Components, err, isOk, Ops, Registries, RegistryOps, Runtimes, type Policy } from '../src'

const flush = () => new Promise(r => setTimeout(r, 0))
const Updated = Ops.source('com.acme', 'counter-updated', Type.Number())
const Inc = Ops.action('com.acme', 'inc', Type.Null(), Type.Number())
const Log = Ops.sink('com.acme', 'log', Type.Unknown())
const Extra = Ops.source('com.acme', 'extra', Type.String())

const counter = () => {
  const c = Components.create({ ns: 'com.acme', name: 'counter' }, () => ({ n: 0 }))
  c.action(Updated, s => s.n)
  c.action(Inc, s => ++s.n, { emits: [Updated] })
  return Components.instantiate(c)
}
const logger = (onLog: (x: unknown) => void = () => {}) => {
  const c = Components.create({ ns: 'com.acme', name: 'logger' }, () => [] as unknown[])
  c.action(Log, (l, x) => { l.push(x); onLog(x) })
  return Components.instantiate(c)
}
const setup = (policy?: Policy) => {
  const rt = Runtimes.create(Registries.create('r'), policy), reg = rt.registry
  const log = logger(); reg.add('log', log)
  return { rt, reg, log, sub: (source: string, op: string) => reg.subscribe({ source, op, listener: 'log', target: Ops.key(Log) }) }
}
const me = { registry: 'r', instance: 'test' }

test('the registry publishes its own changes as events from itself', async () => {
  const { reg, log, sub } = setup()
  sub('registry', 'composable/instance-added')
  reg.add('c', counter()); await flush()
  expect(log.value).toEqual([{ type: 'instance-added', instance: 'c', ops: ['com.acme/counter-updated', 'com.acme/inc'] }])
})

test('calling an action runs it, and its emit reaches subscribers', async () => {
  const { rt, reg, log, sub } = setup()
  reg.add('c', counter()); sub('c', Ops.key(Updated))
  expect(await rt.call(me, 'c', 'com.acme/inc', null)).toEqual({ value: 1 })
  expect(log.value).toEqual([1])
})

test('a call whose argument breaks the schema is refused', async () => {
  const { rt, reg } = setup()
  reg.add('c', counter())
  expect(isOk(await rt.call(me, 'c', 'com.acme/inc', 'x'))).toBe(false)
  expect(isOk(await rt.call(me, 'nobody', 'com.acme/inc', null))).toBe(false)
})

test('publishing an undeclared op, or bad data, is refused', async () => {
  const { rt, reg } = setup()
  reg.add('c', counter())
  expect(isOk(await rt.notify({ from: { registry: 'r', instance: 'c' }, op: 'com.acme/nope', data: 1 }))).toBe(false)
  expect(isOk(await rt.notify({ from: { registry: 'r', instance: 'c' }, op: Ops.key(Updated), data: 'one' }))).toBe(false)
})

test('one failing listener does not stop the next', async () => {
  const { rt, reg, log, sub } = setup()
  const bad = Components.create({ ns: 't', name: 'bad' }, () => 0)
  bad.action(Log, () => { throw new Error('no') })
  reg.add('c', counter()); reg.add('bad', Components.instantiate(bad))
  reg.subscribe({ source: 'c', op: Ops.key(Updated), listener: 'bad', target: Ops.key(Log) })
  sub('c', Ops.key(Updated))
  const r = await rt.notify({ from: { registry: 'r', instance: 'c' }, op: Ops.key(Updated), data: 5 })
  expect(r).toEqual({ value: [err('no'), { value: undefined }] })
  expect(log.value).toEqual([5])
})

test('a listener removed during delivery gets an error in its own slot', async () => {
  const { rt, reg, log, sub } = setup()
  reg.add('c', counter())
  reg.add('remover', logger(() => { reg.remove('log') }))
  reg.subscribe({ source: 'c', op: Ops.key(Updated), listener: 'remover', target: Ops.key(Log) })
  sub('c', Ops.key(Updated))
  const r = await rt.notify({ from: { registry: 'r', instance: 'c' }, op: Ops.key(Updated), data: 5 }) as { value: unknown[] }
  expect(isOk(r.value[0] as any)).toBe(true)
  expect(isOk(r.value[1] as any)).toBe(false)
  expect(log.value).toEqual([])
})

test('an op registered at runtime is announced as op-added', async () => {
  const { reg, log, sub } = setup()
  const c = counter(); reg.add('c', c)
  sub('*', 'composable/op-added')
  c.env.register(Extra); await flush()
  expect(log.value).toEqual([{ type: 'op-added', instance: 'c', op: 'com.acme/extra' }])
})

test('the handles given to instances go through the policy', async () => {
  const refuse: Policy = inner => ({ ...inner, notify: async () => err('refused') })
  const { reg } = setup(refuse)
  const c = counter(); reg.add('c', c)
  expect(await c.env.notify(Updated, 1)).toEqual([err('refused')])
})

test('the registry is callable as an instance in itself', async () => {
  const { rt } = setup()
  const s = await rt.call(me, 'registry', Ops.key(RegistryOps.snapshot), null) as { value: { instances: { id: string }[] } }
  expect(s.value.instances.map(i => i.id)).toEqual(['registry', 'log'])
  expect(isOk(await rt.call(me, 'registry', Ops.key(RegistryOps.remove), 'ghost'))).toBe(false)
})

test('an action that unregisters its own op still returns a Result', async () => {
  const c = Components.create({ ns: 't', name: 'quitter' }, () => 0)
  c.action(Log, (_s, _x, env) => { env.unregister(Log) })
  expect(await Components.invoke(Components.instantiate(c), Ops.key(Log), 1)).toEqual({ value: undefined })
})

test('a delivery is checked against the listener\'s input schema', async () => {
  const { rt, reg } = setup()
  const Num = Ops.sink('t', 'num', Type.Number()), got: unknown[] = []
  const c = Components.create({ ns: 't', name: 'nums' }, () => got); c.action(Num, (g, n) => { g.push(n) })
  reg.add('c', counter()); reg.add('n', Components.instantiate(c))
  reg.subscribe({ source: 'registry', op: 'composable/instance-added', listener: 'n', target: Ops.key(Num) })
  reg.add('x', counter()); await flush()
  expect(got).toEqual([])
})

test('a registry gets one runtime', () => {
  const reg = Registries.create('r'); Runtimes.create(reg)
  expect(() => Runtimes.create(reg)).toThrow()
})

test('announcing a change for an unknown instance is refused', () => {
  const reg = Runtimes.create(Registries.create('r')).registry
  expect(isOk(reg.announce('ghost', 'op-added', Log))).toBe(false)
})

test('listen reports every call, publish and delivery, as they happen', async () => {
  const { rt, reg, sub } = setup()
  reg.add('c', counter()); sub('c', Ops.key(Updated))
  const seen: any[] = []
  const stop = rt.listen(t => { seen.push(t) })
  await rt.call(me, 'c', 'com.acme/inc', null)
  expect(seen.map(t => t.kind)).toEqual(['delivery', 'publish', 'call'])   // innermost first: each is told when it ends
  const [delivery, publish, call] = seen
  expect(delivery).toMatchObject({ kind: 'delivery', from: { registry: 'r', instance: 'c' }, target: 'log', op: Ops.key(Log), data: 1, result: { value: undefined } })
  expect(delivery.subscription).toBe(reg.snapshot().subscriptions.find(s => s.listener === 'log')!.id)
  expect(publish).toMatchObject({ kind: 'publish', from: { registry: 'r', instance: 'c' }, op: Ops.key(Updated), data: 1 })
  expect(call).toMatchObject({ kind: 'call', from: me, target: 'c', op: 'com.acme/inc', data: null, result: { value: 1 } })
  expect(typeof call.time).toBe('number')
  stop()
  await rt.call(me, 'c', 'com.acme/inc', null)
  expect(seen).toHaveLength(3)
})

test('a policy-wrapped runtime passes listen through', async () => {
  const { rt, reg } = setup(inner => ({ ...inner }))
  reg.add('c', counter())
  const seen: unknown[] = []
  rt.listen(t => { seen.push(t) })
  await rt.call(me, 'c', 'com.acme/inc', null)
  expect(seen.length).toBeGreaterThan(0)
})
