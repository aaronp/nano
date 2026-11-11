import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Components, hasRuntime, isOk, Ops, Registries, Runtimes, Strategies, unwrap, wrap, WrapperOps, type HasRuntime, type Trace } from '../src'

const flush = () => new Promise(r => setTimeout(r, 0))
const Updated = Ops.source('com.acme', 'counter-updated', Type.Number())
const Inc = Ops.action('com.acme', 'inc', Type.Null(), Type.Number())
const Log = Ops.sink('com.acme', 'log', Type.Unknown())
const Go = Ops.action('com.acme', 'go', Type.Null(), Type.Unknown())

const counter = () => {
  const c = Components.create({ ns: 'com.acme', name: 'counter' }, () => ({ n: 0 }))
  c.action(Updated, s => s.n)
  c.action(Inc, s => ++s.n, { emits: [Updated] })
  return Components.instantiate(c)
}
const logger = () => {
  const c = Components.create({ ns: 'com.acme', name: 'logger' }, () => [] as unknown[])
  c.action(Log, (l, x) => { l.push(x) })
  return Components.instantiate(c)
}
const setup = () => {
  const rt = Runtimes.create(Registries.create('r')), reg = rt.registry
  const log = logger(), c = counter(); reg.add('log', log); reg.add('c', c)
  reg.subscribe({ source: 'c', op: Ops.key(Updated), listener: 'log', target: Ops.key(Log) })
  return { rt, reg, log, c }
}
const me = { registry: 'r', instance: 'test' }
const must = <A>(r: { value: A } | { error: string }): A => { if ('error' in r) throw new Error(r.error); return r.value }

test('a wrapped instance still answers calls and its subscribers still hear it, once', async () => {
  const { rt, log } = setup()
  must(wrap(rt, 'c', Strategies.forward))
  expect(await rt.call(me, 'c', Ops.key(Inc), null)).toMatchObject({ value: 1 })
  await flush()
  expect(log.value).toEqual([1])
})

test('a delivery to a wrapped listener reaches the part', async () => {
  const { rt, log } = setup()
  must(wrap(rt, 'log', Strategies.forward))
  await rt.call(me, 'c', Ops.key(Inc), null)
  await flush()
  expect(log.value).toEqual([1])
})

test('every hop is traced on the inner runtime', async () => {
  const { rt } = setup()
  const w = must(wrap(rt, 'c', Strategies.forward)), seen: Trace[] = []
  w.runtime.listen(t => { seen.push(t) })
  await rt.call(me, 'c', Ops.key(Inc), null)
  expect(seen.some(t => t.kind === 'call' && t.target === 'c' && t.op === Ops.key(Inc))).toBe(true)
})

test("a part's call to an outer neighbour and to registry reaches the outer runtime", async () => {
  const { rt, reg, log } = setup()
  const c = Components.create({ ns: 'com.acme', name: 'caller' }, () => ({}))
  c.action(Go, async (_, __, env) => {
    const h = env.handles()[0]!
    await h.call('log', Log, 'hi')
    return must(await h.call('registry', Ops.action('composable', 'snapshot', Type.Null(), Type.Unknown()), null))
  })
  reg.add('caller', Components.instantiate(c))
  must(wrap(rt, 'caller', Strategies.forward))
  const snap = must(await rt.call(me, 'caller', Ops.key(Go), null)) as { id: string }
  expect(log.value).toEqual(['hi'])
  expect(snap.id).toBe('r')
})

test('unwrap restores the original; it publishes once, to the outer registry only', async () => {
  const { rt, reg, log, c } = setup()
  must(wrap(rt, 'c', Strategies.forward))
  must(unwrap(rt, 'c'))
  expect(reg.get('c')).toBe(c)
  expect(c.env.handles().map(h => h.coord)).toEqual([{ registry: 'r', instance: 'c' }])
  await rt.call(me, 'c', Ops.key(Inc), null)
  await flush()
  expect(log.value).toEqual([1])
})

test('wrap of an unknown id and unwrap of a non-wrapper error', () => {
  const { rt } = setup()
  expect(isOk(wrap(rt, 'nope', Strategies.forward))).toBe(false)
  expect(isOk(unwrap(rt, 'c'))).toBe(false)
})

test('hasRuntime tells a wrapper value from a plain one', () => {
  const { rt, reg } = setup()
  expect(hasRuntime(reg.get('c')!.value)).toBe(false)
  must(wrap(rt, 'c', Strategies.forward))
  expect(hasRuntime(reg.get('c')!.value)).toBe(true)
})

test('the wrapper keeps the component id and offers the parts op', async () => {
  const { rt, reg } = setup()
  must(wrap(rt, 'c', Strategies.forward))
  expect(reg.snapshot().instances.find(i => i.id === 'c')!.component).toBe('com.acme/counter')
  expect(await rt.call(me, 'c', Ops.key(WrapperOps.parts), null)).toEqual({ value: ['c'] })
  expect((reg.get('c')!.value as HasRuntime).runtime.registry.snapshot().instances.find(i => i.id === 'c')!.owner).toEqual({ kind: 'wrapper', name: 'c' })
})
