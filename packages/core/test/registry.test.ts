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
  expect(r.snapshot()).toEqual({ id: 'r', instances: [{ id: 'l', ops: [Ping] }], subscriptions: [(s as { value: any }).value] })
  expect(isOk(r.unsubscribe((s as { value: { id: string } }).value.id))).toBe(true)
  const n = seen.length, stop = r.listen(() => {}); stop()
  expect(seen.at(-1)!.type).toBe('subscription-closed')
  expect(seen).toHaveLength(n)
})

test('emit passes a delta to every listener, and unlisten stops it', () => {
  const r = Registries.create('r'), got: Delta[] = [], stop = r.listen(d => { got.push(d) })
  r.emit({ type: 'op-added', instance: 'l', op: 't/x' }); stop()
  r.emit({ type: 'op-added', instance: 'l', op: 't/y' })
  expect(got).toEqual([{ type: 'op-added', instance: 'l', op: 't/x' }])
})
