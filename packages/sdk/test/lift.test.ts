import { test, expect } from 'bun:test'
import Type from 'typebox'
import { Components, Contexts } from '../src'

const MyThing = {
  echo: Type.Function([Type.Object({ x: Type.String() })], Type.String(), { description: 'Return x' }),
  repeat: Type.Function([Type.Object({ y: Type.String(), times: Type.Integer({ minimum: 0 }) })], Type.String(), { description: 'Repeat y, times times' }),
  slow: Type.Function([Type.Object({})], Type.Number()),
}
const myThing = Components.lift({ author: 'acme', id: 'my-thing' }, MyThing, {
  echo: ({ x }) => x,
  repeat: ({ y, times }) => y.repeat(times),
  slow: async () => 42,
})
const root = () => { const s = Contexts.scope(); return Object.assign(s, { page: s.context('page') }) }

test('lift: one action per function, named from the id, described, with object input', () => {
  expect(myThing.manifest.ops.map(a => [a.name, a.description])).toEqual([
    ['acme/my-thing/echo', 'Return x'], ['acme/my-thing/repeat', 'Repeat y, times times'], ['acme/my-thing/slow', 'slow']])
  expect(myThing.ops.repeat.input).toBe(MyThing.repeat.parameters[0])
})

test('client: typed calls, validated input and output, async impls, never throws', async () => {
  const b = root()
  await b.add('thing', myThing)
  const thing = Components.client(b.page, 'thing', myThing.ops)
  const r = await thing.repeat({ y: 'ab', times: 3 })
  expect(r).toEqual({ type: 'success', data: 'ababab' })
  if (r.type === 'success') { const s: string = r.data; void s }
  expect(await thing.slow({})).toEqual({ type: 'success', data: 42 })
  const bad = await thing.repeat({ y: 'ab', times: -1 })
  expect(bad.type === 'error' && bad.error.code).toBe('validation')
  const missing = Components.client(b.page, 'nope', myThing.ops)
  expect((await missing.echo({ x: '' })).type).toBe('error')
})

test('output is validated too', async () => {
  const liar = Components.lift({ author: 't', id: 'liar' }, { n: Type.Function([Type.Object({})], Type.Number()) }, { n: () => 'nope' as unknown as number })
  const b = root()
  await b.add('l', liar)
  const r = await Components.client(b.page, 'l', liar.ops).n({})
  expect(r.type === 'error' && r.error.message).toBe('output invalid for t/liar/n')
})

test('lift rejects malformed interfaces and missing implementations', () => {
  const id = { author: 't', id: 'x' }
  expect(() => Components.lift(id, { f: Type.String() as never }, { f: () => '' } as never)).toThrow('f must be Type.Function')
  expect(() => Components.lift(id, { f: Type.Function([Type.String(), Type.String()], Type.String()) as never }, { f: () => '' } as never)).toThrow('f must be')
  expect(() => Components.lift(id, { f: Type.Function([Type.Object({})], Type.String()) }, {} as never)).toThrow('no implementation for f')
})

test('client works with declare-made actions and the model holds the impl', async () => {
  const b = root()
  const model = await b.add('thing', myThing)
  expect(model.state.echo({ x: 'direct' })).toBe('direct')
  // @ts-expect-error input is typed from the interface
  void Components.client(b.page, 'thing', myThing.ops).echo({ x: 1 })
})

test('implementations are typed from the interface', () => {
  // @ts-expect-error repeat's input has no `n`, and must return a string
  void (() => Components.lift({ author: 't', id: 'y' }, MyThing, { echo: ({ x }) => x, repeat: ({ n }) => n, slow: () => 1 }))
})
