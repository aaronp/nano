import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Components, isOk, Ops, Registries, type Delta } from '../src'

const Ping = Ops.sink('t', 'ping', Type.Unknown())
const thing = () => { const c = Components.create({ ns: 't', name: 'thing' }, () => ({})); c.action(Ping, () => {}); return Components.instantiate(c) }
const watched = () => { const r = Registries.create('r'), seen: Delta[] = []; r.listen(d => { seen.push(d) }); return { r, seen } }

test('an id is added once; the first instance stays', () => {
  const { r } = watched(), a = thing()
  expect(isOk(r.add('a', a))).toBe(true)
  expect(isOk(r.add('a', thing()))).toBe(false)
  expect(r.get('a')).toBe(a)
})

test('the listener must exist; the source need not', () => {
  const { r } = watched()
  expect(isOk(r.subscribe({ source: 'x', op: 't/ping', listener: 'nobody', target: 't/ping' }))).toBe(false)
  r.add('l', thing())
  expect(isOk(r.subscribe({ source: 'ghost', op: 't/ping', listener: 'l', target: 't/ping' }))).toBe(true)
})

test('removing a listener closes its subscriptions first, then removes it', () => {
  const { r, seen } = watched()
  r.add('l', thing())
  r.subscribe({ source: '*', op: 't/ping', listener: 'l', target: 't/ping' })
  r.remove('l')
  expect(seen.map(d => d.type)).toEqual(['instance-added', 'subscription-opened', 'subscription-closed', 'instance-removed'])
  expect(r.snapshot().subscriptions).toEqual([])
  expect(isOk(r.remove('l'))).toBe(false)
})

test('matching includes subscriptions to any source', () => {
  const { r } = watched()
  r.add('l', thing())
  r.subscribe({ source: '*', op: 't/ping', listener: 'l', target: 't/ping' })
  r.subscribe({ source: 'a', op: 't/ping', listener: 'l', target: 't/ping' })
  r.subscribe({ source: 'b', op: 't/ping', listener: 'l', target: 't/ping' })
  expect(r.matching('a', 't/ping').map(s => s.source)).toEqual(['*', 'a'])
})

test('a snapshot lists each instance with its ops; unsubscribe and unlisten work', () => {
  const { r, seen } = watched()
  r.add('l', thing())
  const s = r.subscribe({ source: '*', op: 't/ping', listener: 'l', target: 't/ping' })
  expect(r.snapshot()).toEqual({ id: 'r', instances: [{ id: 'l', component: 't/thing', ops: [Ping] }], subscriptions: [(s as { value: any }).value] })
  expect(isOk(r.unsubscribe((s as { value: { id: string } }).value.id))).toBe(true)
  const n = seen.length, stop = r.listen(() => {}); stop()
  expect(seen.at(-1)!.type).toBe('subscription-closed')
  expect(seen).toHaveLength(n)
})

test('announce passes an op change to every listener, and unlisten stops it', () => {
  const r = Registries.create('r'), got: Delta[] = []
  r.add('l', thing()); const stop = r.listen(d => { got.push(d) })
  r.announce('l', 'op-added', Ops.sink('t', 'x', Type.Null())); stop()
  r.announce('l', 'op-added', Ops.sink('t', 'y', Type.Null()))
  expect(got).toEqual([{ type: 'op-added', instance: 'l', op: 't/x' }])
})

test('matching keeps subscription order across specific and any-source subscriptions, and forgets closed ones', () => {
  const { r } = watched()
  r.add('l', thing())
  const sub = (source: string, op = 't/ping') => (r.subscribe({ source, op, listener: 'l', target: 't/ping' }) as { value: { id: string } }).value.id
  const a = sub('a'); sub('*'); sub('a'); sub('a', 't/other'); sub('b')
  expect(r.matching('a', 't/ping').map(s => s.source)).toEqual(['a', '*', 'a'])
  r.unsubscribe(a)
  expect(r.matching('a', 't/ping').map(s => s.source)).toEqual(['*', 'a'])
  r.remove('l')
  expect(r.matching('a', 't/ping')).toEqual([])
})

test("a snapshot names each instance's component and owner", () => {
  const { r } = watched()
  r.add('a', thing(), { kind: 'widget', name: 'c-x' }); r.add('b', thing())
  expect(r.snapshot().instances).toEqual([
    { id: 'a', component: 't/thing', owner: { kind: 'widget', name: 'c-x' }, ops: [Ping] },
    { id: 'b', component: 't/thing', ops: [Ping] },
  ])
})

test('instance-added carries component and owner', () => {
  const { r, seen } = watched()
  r.add('a', thing(), { kind: 'platform', name: 'p' })
  expect(seen[0]).toEqual({ type: 'instance-added', instance: 'a', ops: ['t/ping'], component: 't/thing', owner: { kind: 'platform', name: 'p' } })
})

test('owner belongs to the entry: shared instances and re-adds', () => {
  const r1 = Registries.create('r1'), r2 = Registries.create('r2'), inst = thing()
  r1.add('a', inst, { kind: 'widget', name: 'w' }); r2.add('a', inst, { kind: 'platform', name: 'p' })
  expect(r1.snapshot().instances[0]!.owner).toEqual({ kind: 'widget', name: 'w' })
  expect(r2.snapshot().instances[0]!.owner).toEqual({ kind: 'platform', name: 'p' })
  r1.remove('a'); r1.add('a', inst, { kind: 'view', name: 'v' })
  expect(r1.snapshot().instances[0]!.owner).toEqual({ kind: 'view', name: 'v' })
  r1.remove('a'); r1.add('a', inst)
  expect(r1.snapshot().instances[0]!.owner).toBeUndefined()
})

test("a snapshot and instance-added carry the component's description, when it has one", () => {
  const { r, seen } = watched()
  const c = Components.create({ ns: 't', name: 'd' }, () => ({}), { description: 'Described' })
  r.add('d', Components.instantiate(c)); r.add('a', thing())
  expect(r.snapshot().instances[0]!.description).toBe('Described')
  expect('description' in r.snapshot().instances[1]!).toBe(false)
  expect((seen[0] as { description?: string }).description).toBe('Described')
})

test('replace keeps subscriptions both ways and the owner, and emits instance-replaced only', () => {
  const { r, seen } = watched()
  r.add('a', thing()); r.add('b', thing(), { kind: 'widget', name: 'w' })
  r.subscribe({ source: 'a', op: 't/ping', listener: 'b', target: 't/ping' })
  r.subscribe({ source: 'b', op: 't/ping', listener: 'a', target: 't/ping' })
  seen.length = 0
  const c = Components.create({ ns: 't', name: 'other' }, () => ({})); c.action(Ping, () => {})
  const other = Components.instantiate(c)
  expect(isOk(r.replace('b', other))).toBe(true)
  expect(r.get('b')).toBe(other)
  expect(r.snapshot().subscriptions).toHaveLength(2)
  expect(r.snapshot().instances.find(i => i.id === 'b')!.owner).toEqual({ kind: 'widget', name: 'w' })
  expect(seen.map(d => d.type)).toEqual(['instance-replaced'])
  expect((seen[0] as { component: string }).component).toBe('t/other')
})

test('replace with an owner sets it; replace of an unknown id errors', () => {
  const { r } = watched()
  r.add('a', thing())
  r.replace('a', thing(), { kind: 'wrapper', name: 'a' })
  expect(r.snapshot().instances[0]!.owner).toEqual({ kind: 'wrapper', name: 'a' })
  expect(isOk(r.replace('nope', thing()))).toBe(false)
})
