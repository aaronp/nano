import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Components, Contexts, defineManifest, type Created } from '../src'
import { rootRef } from './fixtures'

const MyThing = {
  echo: Type.Function([Type.Object({ x: Type.String() })], Type.String(), { description: 'Return x' }),
  repeat: Type.Function([Type.Object({ y: Type.String(), times: Type.Integer({ minimum: 0 }) })], Type.String(), { description: 'Repeat y, times times' }),
  slow: Type.Function([Type.Object({})], Type.Number()),
}
const myThing = Components.lift({ author: 'acme', id: 'my-thing' }, '0.1.0', MyThing, {
  echo: ({ x }) => x,
  repeat: ({ y, times }) => y.repeat(times),
  slow: async () => 42,
})
const root = () => Contexts.bus({ self: { ...rootRef, manifest: defineManifest({ id: { author: 't', id: 'r' }, version: '0', emits: [], consumes: [] }) } })

test('lift: one action per function, named from the id, described, with object input', () => {
  expect(myThing.manifest.consumes.map(a => [a.name, a.description])).toEqual([
    ['acme/my-thing/echo', 'Return x'], ['acme/my-thing/repeat', 'Repeat y, times times'], ['acme/my-thing/slow', 'slow']])
  expect(myThing.actions.repeat.input).toBe(MyThing.repeat.parameters[0])
})

test('client: typed calls, validated input and output, async impls, never throws', async () => {
  const b = root()
  const thing = Components.client(b, await b.register(myThing, 'thing'), myThing.actions)
  const r = await thing.repeat({ y: 'ab', times: 3 })
  expect(r).toEqual({ type: 'success', data: 'ababab' })
  if (r.type === 'success') { const s: string = r.data; void s }
  expect(await thing.slow({})).toEqual({ type: 'success', data: 42 })
  const bad = await thing.repeat({ y: 'ab', times: -1 })
  expect(bad.type === 'error' && bad.error.code).toBe('validation')
  const missing = Components.client(b, { namespace: ['root'], instance: 'nope' }, myThing.actions)
  expect((await missing.echo({ x: '' })).type).toBe('error')
})

test('output is validated too', async () => {
  const liar = Components.lift({ author: 't', id: 'liar' }, '0', { n: Type.Function([Type.Object({})], Type.Number()) }, { n: () => 'nope' as unknown as number })
  const b = root()
  const r = await Components.client(b, await b.register(liar, 'l'), liar.actions).n({})
  expect(r.type === 'error' && r.error.message).toBe('output invalid for t/liar/n')
})

test('lift rejects malformed interfaces and missing implementations', () => {
  const id = { author: 't', id: 'x' }
  expect(() => Components.lift(id, '0', { f: Type.String() as never }, { f: () => '' } as never)).toThrow('f must be Type.Function')
  expect(() => Components.lift(id, '0', { f: Type.Function([Type.String(), Type.String()], Type.String()) as never }, { f: () => '' } as never)).toThrow('f must be')
  expect(() => Components.lift(id, '0', { f: Type.Function([Type.Object({})], Type.String()) }, {} as never)).toThrow('no implementation for f')
})

test('client works with declare-made actions and the model holds the impl', async () => {
  const b = root()
  const inst = await b.register(myThing, 'thing')
  expect((b.component(inst) as Created<typeof myThing>).state.echo({ x: 'direct' })).toBe('direct')
  // @ts-expect-error input is typed from the interface
  void Components.client(b, inst, myThing.actions).echo({ x: 1 })
})

test('implementations are typed from the interface', () => {
  // @ts-expect-error repeat's input has no `n`, and must return a string
  void (() => Components.lift({ author: 't', id: 'y' }, '0', MyThing, { echo: ({ x }) => x, repeat: ({ n }) => n, slow: () => 1 }))
})
