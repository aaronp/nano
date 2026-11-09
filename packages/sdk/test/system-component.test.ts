import { test, expect } from 'bun:test'
import Type from 'typebox'
import { unwrap, Components, Systems, ok, type Instance } from '../src'

const flush = () => new Promise(r => setTimeout(r, 0))
const sys = Systems.ops

const N = Components.declare({ author: 't', id: 'numbers' })
const emitted = N.op('emitted', 'a number', { output: Type.Number() })
const numbers = N.define({ state: () => null })
const K = Components.declare({ author: 't', id: 'keeper' })
const keep = K.op('keep', 'keep a number', { input: Type.Number() })
const keeper = () => { const kept: number[] = []; return Object.assign(K.define({ state: () => kept, handlers: [[keep, (n, { state }) => { state.push(n) }]] }), { kept }) }

/** A runtime with its System component registered as 'system', and a page handle. */
const world = (catalog: { manifest: any; create(): any }[] = []) => {
  const rt = Systems.create(), page = unwrap(rt.register('page', Components.party()))
  rt.register('system', Systems.component(rt, { catalog }).create() as never)
  return { rt, page }
}

test('instances, changed, definitions, create from the catalog, remove', async () => {
  // setup: a System component whose catalog has the keeper
  const k = keeper()
  const { rt, page } = world([k])
  const seen: string[][] = []
  page.subscribe(sys.changed, list => { seen.push(list.map((i: Instance) => i.id)) }, { from: 'system' })
  // call out our methods under test
  rt.register('numbers', numbers.create())
  expect(await page.call('system', sys.create, { component: { author: 't', id: 'keeper' }, name: 'k1' })).toEqual(ok({ name: 'k1' }))
  const list = await page.call('system', sys.instances, null)
  expect(list.type === 'success' && list.data.map((i: Instance) => i.id)).toEqual(['page', 'system', 'numbers', 'k1'])
  const defs = await page.call('system', sys.definitions, null)
  expect(defs.type === 'success' && defs.data.map(m => m.id.id)).toEqual(['keeper'])
  const nope = await page.call('system', sys.create, { component: { author: 't', id: 'nope' }, name: 'x' })
  expect(nope.type === 'error' && nope.error.code).toBe('unknown-target')
  await page.call('system', sys.remove, { name: 'k1' })
  expect(seen.at(-1)).toEqual(['page', 'system', 'numbers'])
})

test('subscribe, unsubscribe and subscriptions by op, announced on every change (whoever made it)', async () => {
  const { rt, page } = world()
  const n = numbers.create(); rt.register('numbers', n); rt.register('keeper', keeper().create() as never)
  const seen: number[] = []
  page.subscribe(sys.subscriptionsChanged, l => { seen.push(l.filter(x => x.target).length) }, { from: 'system' })
  const made = unwrap(await page.call('system', sys.subscribe, { source: 'numbers', op: emitted.name, listener: 'keeper', target: keep.name }))
  rt.register('k2', keeper().create() as never)
  unwrap(rt.subscribe({ source: 'numbers', op: emitted.name, listener: 'k2', target: keep.name }))   // on the runtime directly
  const listed = unwrap(await page.call('system', sys.subscriptions, null))
  expect(listed.filter(x => x.target).length).toBe(2)
  await page.call('system', sys.unsubscribe, { id: made.id })
  await flush()
  expect(seen).toEqual([0, 1, 2, 1])   // the page's own listening, then made via the op, made on the runtime, removed: all announced
})

test('bind and unbind dependencies', async () => {
  const { rt, page } = world()
  // dependencies: bind a greeter's `upper` to a library op of the same shape
  const G = Components.declare({ author: 't', id: 'greeter' })
  G.dependency('upper', 'uppercase', { op: { name: 'u', input: Type.String(), output: Type.String() } })
  const greet = G.op('greet', 'greet', { input: Type.String(), output: Type.String(), requires: ['upper'] })
  rt.register('greeter', G.define({ state: () => null, handlers: [[greet, async (s, { deps }) => { const r = await deps.upper(s); return r.type === 'success' ? ok(`HI ${r.data}`) : r }]] }).create())
  const U = Components.lift({ author: 'lib', id: 'upper' }, { up: Type.Function([Type.String()], Type.String()) }, { up: s => s.toUpperCase() })
  rt.register('up', U.create())
  await page.call('system', sys.bind, { from: 'greeter', dependency: 'upper', to: 'up', op: U.ops.up.name })
  expect(await page.call('greeter', greet, 'ada')).toEqual(ok('HI ADA'))
  await page.call('system', sys.unbind, { from: 'greeter', dependency: 'upper' })
  expect((await page.call('greeter', greet, 'ada')).type).toBe('error')
})

test('sandboxes are isolated; a System of Systems exposes an inner System in an outer one', async () => {
  const a = world(), b = world()
  a.rt.register('numbers', numbers.create())
  const ids = async (w: ReturnType<typeof world>) => { const r = await w.page.call('system', sys.instances, null); return r.type === 'success' ? r.data.map((i: Instance) => i.id) : [] }
  expect(await ids(a)).toEqual(['page', 'system', 'numbers'])
  expect(await ids(b)).toEqual(['page', 'system'])
  // the inner System, seen from the outer one through a System component registered there
  const outer = Systems.create(), page = unwrap(outer.register('page', Components.party()))
  outer.register('inner', Systems.component(a.rt).create() as never)
  const r = await page.call('inner', sys.instances, null)
  expect(r.type === 'success' && r.data.map((i: Instance) => i.id)).toEqual(['page', 'system', 'numbers'])
  const heard: string[][] = []
  page.subscribe(sys.changed, list => { heard.push(list.map((i: Instance) => i.id)) }, { from: 'inner' })
  a.rt.register('more', numbers.create())
  expect(heard.at(-1)).toEqual(['page', 'system', 'numbers', 'more'])
})

test('a refused unbind is reported, not taken as success', async () => {
  const rt = Systems.create(), page = unwrap(rt.register('page', Components.party()))
  rt.register('a', numbers.create()); rt.register('b', numbers.create())
  rt.register('system', Systems.component(Systems.restrict(rt, 'a')).create() as never)
  expect(await page.call('system', sys.unbind, { from: 'b', dependency: 'x' })).toEqual({ type: 'not-allowed', reason: 'a may only act for itself' })
})
