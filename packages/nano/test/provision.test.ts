import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, type Interface } from '../src/iface.ts'
import { failure, success } from '../src/result.ts'
import { implementation, provide, type Implementation } from '../src/implementation.ts'
import { provider } from '../src/provider.ts'
import { createRegistry } from '../src/registry.ts'
import type { Policy } from '../src/policy.ts'
import type { NanoContext } from '../src/context.ts'
import type { Selector } from '../src/selector.ts'
import { createRuntime } from '../src/runtime/index.ts'

const Str = defineSchema('Str', Type.String())
const face = (coord: string) => iface(coord, { ping: op.action('ping', Str, Str) })
const Foo = face('acme/foo'), Bar = face('acme/bar'), Baz = face('acme/baz'), DB = face('acme/db'), CycA = face('acme/cyc-a'), CycB = face('acme/cyc-b')

const contexts = new Map<string, NanoContext>()
const impl = (coord: string, provides: Interface[], dependencies: Record<string, Selector> = {}): Implementation =>
  implementation(coord, { provides, dependencies, make: ctx => { contexts.set(ctx.instance, ctx); return provides.map(i => provide(i, { ping: async (_c, s) => success(s) })) } })

const foo = impl('acme/app/foo', [Foo], { bar: Bar })
const bar = impl('acme/app/bar', [Bar], { baz: Baz })
const baz = impl('acme/app/baz', [Baz])
const user = impl('acme/app/user', [], { store: DB })
const tagged = impl('acme/app/tagged', [], { cache: { tags: ['cache'] } })
const byImpl = impl('acme/app/by-impl', [], { log: { implementation: 'acme/app/baz' } })
const needsBoom = impl('acme/app/needs-boom', [], { boom: { provider: 'acme/bad' } })
const cycA = impl('acme/cyc/a', [CycA], { b: CycB })
const cycB = impl('acme/cyc/b', [CycB], { a: CycA })
// R → A → { D, B }, B → C → { B, D }: a loop, and D wanted twice.
const LA = face('acme/l-a'), LB = face('acme/l-b'), LC = face('acme/l-c'), LD = face('acme/l-d')
const loopR = impl('acme/loop/r', [], { a: LA })
const loopA = impl('acme/loop/a', [LA], { d: LD, b: LB })
const loopB = impl('acme/loop/b', [LB], { c: LC })
const loopC = impl('acme/loop/c', [LC], { b: LB, d: LD })
const loopD = impl('acme/loop/d', [LD])
// A make that awaits its dependency: construction is not use, so it fails at once instead of waiting.
const during = new Map<string, unknown[]>()
const blocking = implementation('acme/loop/blocking', { provides: [], dependencies: { d: LD }, make: async ctx => {
  during.set(ctx.instance, [await ctx.one(LD, d => d.ping('hi')), await ctx.optional(LD, d => d.ping('hi')), await ctx.all(LD, d => d.ping('hi'))])
  return []
} })
// A pass held open by a slow make, and an outside instance that calls into it meanwhile.
const Slow = face('acme/l-slow')
const slow = implementation('acme/loop/slow', { provides: [Slow], make: async () => { await new Promise(r => setTimeout(r, 10)); return [provide(Slow, { ping: async (_c, s) => success(s) })] } })
const waits = impl('acme/loop/waits', [], { d: LD, s: Slow })
const outsider = impl('acme/loop/outsider', [], { d: LD })
// An instance that, once made, calls its dependency while a slow make still holds the pass open.
const early = new Map<string, Promise<unknown>>()
const eager = implementation('acme/loop/eager', { provides: [], dependencies: { s: Slow, d: LD }, make: ctx => {
  setTimeout(() => early.set(ctx.instance, ctx.one(LD, d => d.ping('hi'))), 0)
  return []
} })
const boom = implementation('acme/bad/boom', { provides: [], make: () => { throw new Error('nope') } })

function setup(policy?: Policy, idTaken?: (id: string) => boolean) {
  const registry = createRegistry()
  for (const p of [
    provider('acme/app', [foo, bar, baz, user, tagged, byImpl, needsBoom]),
    provider('acme/db', [impl('acme/db/mem', [DB]), impl('acme/db/file', [DB])]),
    provider('acme/cyc', [cycA, cycB]),
    provider('acme/bad', [boom]),
    provider('acme/loop', [loopR, loopA, loopB, loopC, loopD, eager, blocking, slow, waits, outsider]),
  ]) registry.add(p)
  return createRuntime('r1', { registry, ...(policy && { policy }), ...(idTaken && { idTaken }) })
}
const edges = (rt: ReturnType<typeof setup>) => rt.subscriptions().map(s => `${s.from} -> ${s.to} ${rt.status(s.id)}`)

describe('provisioning', () => {
  test('an existing single match is connected, nothing is made', async () => {
    const rt = setup()
    await rt.create('z', 'acme/app/baz')
    expect(await rt.create('b', 'acme/app/bar', { provision: true })).toEqual(success({ pod: 'b', instances: ['b#0'], unsatisfied: [] }))
    expect(rt.instances()).toEqual(['z#0', 'b#0'])
    expect(edges(rt)).toEqual(['b#0 -> z#0 live'])
  })
  test('a single provider is made and connected, recursively', async () => {
    const rt = setup()
    expect(await rt.create('f', 'acme/app/foo', { provision: true })).toEqual(success({ pod: 'f', instances: ['f#0'], unsatisfied: [] }))
    expect(rt.instances()).toEqual(['f#0', 'bar-1#0', 'baz-1#0'])
    expect(edges(rt)).toEqual(['bar-1#0 -> baz-1#0 live', 'f#0 -> bar-1#0 live'])
  })
  test('a made instance takes the first free id', async () => {
    const rt = setup()
    await rt.create('bar-1', 'acme/db/mem')
    await rt.create('f', 'acme/app/foo', { provision: true })
    expect(rt.instances()).toContain('bar-2#0')
  })
  test('a made instance skips ids taken elsewhere in the application', async () => {
    const rt = setup(undefined, id => id === 'bar-1')
    await rt.create('f', 'acme/app/foo', { provision: true })
    expect(rt.instances()).toContain('bar-2#0')
  })
  test('two matching implementations leave it unsatisfied with `2 match`', async () => {
    const rt = setup()
    expect(await rt.create('u', 'acme/app/user', { provision: true })).toEqual(success({ pod: 'u', instances: ['u#0'], unsatisfied: [{ role: 'store', reason: '2 match' }] }))
    expect(rt.instances()).toEqual(['u#0'])
  })
  test('two matching members leave it unsatisfied with `2 match`, even when one implementation matches', async () => {
    const rt = setup()
    await rt.create('z1', 'acme/app/baz')
    await rt.create('z2', 'acme/app/baz')
    expect(await rt.create('b', 'acme/app/bar', { provision: true })).toEqual(success({ pod: 'b', instances: ['b#0'], unsatisfied: [{ role: 'baz', reason: '2 match' }] }))
    expect(rt.subscriptions()).toEqual([])
  })
  test('a dependency already connected is left alone', async () => {
    const rt = setup()
    await rt.create('z1', 'acme/app/baz')
    await rt.create('z2', 'acme/app/baz')
    rt.subscribe({ kind: 'call', from: 'b#0', to: 'z2#0' })
    expect(await rt.create('b', 'acme/app/bar', { provision: true })).toEqual(success({ pod: 'b', instances: ['b#0'], unsatisfied: [] }))
    expect(edges(rt)).toEqual(['b#0 -> z2#0 live'])
  })
  test('a selector naming only tags matches no implementation', async () => {
    const rt = setup()
    expect(await rt.create('t', 'acme/app/tagged', { provision: true })).toEqual(success({ pod: 't', instances: ['t#0'], unsatisfied: [{ role: 'cache', reason: 'nothing matches' }] }))
  })
  test('a selector may name the implementation', async () => {
    const rt = setup()
    expect((await rt.create('i', 'acme/app/by-impl', { provision: true })).ok).toBe(true)
    expect(edges(rt)).toEqual(['i#0 -> baz-1#0 live'])
  })
  test('mutual dependencies connect both ways', async () => {
    const rt = setup()
    expect(await rt.create('a', 'acme/cyc/a', { provision: true })).toEqual(success({ pod: 'a', instances: ['a#0'], unsatisfied: [] }))
    expect(rt.instances()).toEqual(['a#0', 'b-1#0'])
    expect(edges(rt)).toEqual(['b-1#0 -> a#0 live', 'a#0 -> b-1#0 live'])
    expect(await contexts.get('a#0')!.one(CycB, b => b.ping('to b'))).toEqual(success('to b'))
    expect(await contexts.get('b-1#0')!.one(CycA, a => a.ping('to a'))).toEqual(success('to a'))
  })
  test('a longer loop connects, making each implementation at most once per pass', async () => {
    const rt = setup()
    expect(await rt.create('r', 'acme/loop/r', { provision: true })).toEqual(success({ pod: 'r', instances: ['r#0'], unsatisfied: [] }))
    expect(rt.instances()).toEqual(['r#0', 'a-1#0', 'd-1#0', 'b-1#0', 'c-1#0'])
    expect(edges(rt)).toEqual([
      'a-1#0 -> d-1#0 live',
      'c-1#0 -> b-1#0 live',
      'c-1#0 -> d-1#0 live',
      'b-1#0 -> c-1#0 live',
      'a-1#0 -> b-1#0 live',
      'r#0 -> a-1#0 live',
    ])
  })
  test('a make that awaits a dependency call fails at once: dependencies are not available while it is being made', async () => {
    const rt = setup()
    await rt.create('k', 'acme/loop/blocking', { provision: true })
    const fail = failure('missing-component', 'k#0: dependencies are not available while it is being made')
    expect(during.get('k#0')).toEqual([fail, fail, []])
    expect(edges(rt)).toEqual(['k#0 -> d-1#0 live'])
  })
  test('a call from outside into an instance of an unfinished pass waits for the pass, then succeeds', async () => {
    const rt = setup()
    await rt.create('o', 'acme/loop/outsider')
    rt.subscribe({ kind: 'call', from: 'o#0', to: 'd-1#0' })
    const order: string[] = []
    const created = rt.create('w', 'acme/loop/waits', { provision: true }).then(() => order.push('pass'))
    await new Promise(r => setTimeout(r, 2))
    expect(rt.instances()).toContain('d-1#0')
    const call = contexts.get('o#0')!.one(LD, d => d.ping('x')).then(r => { order.push('call'); return r })
    await created
    expect(await call).toEqual(success('x'))
    expect(order).toEqual(['pass', 'call'])
  })
  test('a call made after make, during the pass, waits for it, then gets the real result', async () => {
    const rt = setup()
    await rt.create('e', 'acme/loop/eager', { provision: true })
    expect(await early.get('e#0')).toEqual(success('hi'))
  })
  test('a policy that throws while provisioning subscribes is a denial with its error', async () => {
    const rt = setup({ isAllowed: (_f, to) => { if (to.startsWith('z#')) throw new Error('bad policy'); return { approved: true } } })
    await rt.create('z', 'acme/app/baz')
    expect(await rt.create('b', 'acme/app/bar', { provision: true })).toEqual(success({ pod: 'b', instances: ['b#0'], unsatisfied: [{ role: 'baz', reason: 'policy threw: bad policy' }] }))
  })
  // Review Focus 5.
  test('a made pod whose make fails (here one named by provider) still gets a waiting subscription; the role is unsatisfied', async () => {
    const rt = setup()
    expect(await rt.create('n', 'acme/app/needs-boom', { provision: true })).toEqual(success({
      pod: 'n', instances: ['n#0'], unsatisfied: [{ role: 'boom', reason: 'subscription s1 to boom-1#0 is waiting' }],
    }))
    expect(rt.instances()).toEqual(['n#0', 'boom-1#0'])
    expect(rt.pod('boom-1')).toMatchObject({ implementation: 'acme/bad/boom', state: 'failed' })
    expect(edges(rt)).toEqual(['n#0 -> boom-1#0 waiting'])
  })
  test('an existing failed instance that matches is connected, and the subscription waits', async () => {
    const rt = setup()
    await rt.create('x', 'acme/bad/boom')
    expect(await rt.create('n', 'acme/app/needs-boom', { provision: true })).toEqual(success({
      pod: 'n', instances: ['n#0'], unsatisfied: [{ role: 'boom', reason: 'subscription s1 to x#0 is waiting' }],
    }))
    expect(rt.pods()).toEqual(['x', 'n'])
    expect(edges(rt)).toEqual(['n#0 -> x#0 waiting'])
  })
  test('provisioning a pod of two settles each instance', async () => {
    const rt = setup()
    expect(await rt.create('b', 'acme/app/bar', { count: 2, provision: true })).toEqual(success({ pod: 'b', instances: ['b#0', 'b#1'], unsatisfied: [] }))
    expect(edges(rt)).toEqual(['b#0 -> baz-1#0 live', 'b#1 -> baz-1#0 live'])
  })
  test('a subscription the policy denies leaves the role unsatisfied with the reason', async () => {
    const rt = setup({ isAllowed: (_f, to) => (to.startsWith('z#') ? { approved: false, reason: 'no baz' } : { approved: true }) })
    await rt.create('z', 'acme/app/baz')
    expect(await rt.create('b', 'acme/app/bar', { provision: true })).toEqual(success({ pod: 'b', instances: ['b#0'], unsatisfied: [{ role: 'baz', reason: 'no baz' }] }))
  })
  test('a throwing policy on a plain subscribe is a denial, observed', () => {
    const seen: unknown[] = []
    const rt = createRuntime('r1', { registry: createRegistry(), policy: { isAllowed: () => { throw new Error('bad policy') } }, pod: { observe: o => seen.push(o) } })
    expect(rt.subscribe({ kind: 'call', from: 'b#0', to: 'z#0' })).toEqual({ ok: false, fail: { type: 'denied', reason: 'policy threw: bad policy' } })
    expect(seen).toEqual([{ kind: 'exception', instance: 'b#0', op: 's1', error: 'policy threw: bad policy' }])
    expect(rt.subscriptions()).toEqual([])
  })
  test('`provision: false` makes nothing', async () => {
    const rt = setup()
    expect(await rt.create('f', 'acme/app/foo', { provision: false })).toEqual(success({ pod: 'f', instances: ['f#0'], unsatisfied: [{ role: 'bar', reason: 'not provisioned' }] }))
    expect(await rt.create('g', 'acme/app/foo')).toEqual(success({ pod: 'g', instances: ['g#0'], unsatisfied: [{ role: 'bar', reason: 'not provisioned' }] }))
    expect(rt.instances()).toEqual(['f#0', 'g#0'])
    expect(rt.subscriptions()).toEqual([])
  })
})
