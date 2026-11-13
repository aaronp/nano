import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, type Interface } from '../src/iface.ts'
import { success } from '../src/result.ts'
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
// An instance whose make calls its dependency before the pass has wired it.
const early = new Map<string, Promise<unknown>>()
const eager = implementation('acme/loop/eager', { provides: [], dependencies: { d: LD }, make: ctx => { early.set(ctx.instance, ctx.one(LD, d => d.ping('hi'))); return [] } })
const boom = implementation('acme/bad/boom', { provides: [], make: () => { throw new Error('nope') } })

function setup(policy?: Policy, idTaken?: (id: string) => boolean) {
  const registry = createRegistry()
  for (const p of [
    provider('acme/app', [foo, bar, baz, user, tagged, byImpl, needsBoom]),
    provider('acme/db', [impl('acme/db/mem', [DB]), impl('acme/db/file', [DB])]),
    provider('acme/cyc', [cycA, cycB]),
    provider('acme/bad', [boom]),
    provider('acme/loop', [loopR, loopA, loopB, loopC, loopD, eager]),
  ]) registry.add(p)
  return createRuntime('r1', { registry, ...(policy && { policy }), ...(idTaken && { idTaken }) })
}
const edges = (rt: ReturnType<typeof setup>) => rt.subscriptions().map(s => `${s.from} -> ${s.to} ${rt.status(s.id)}`)

describe('provisioning', () => {
  test('an existing single match is connected, nothing is made', async () => {
    const rt = setup()
    await rt.create('z', 'acme/app/baz')
    expect(await rt.create('b', 'acme/app/bar', { provision: true })).toEqual(success({ coord: 'acme/app/bar#b', unsatisfied: [] }))
    expect(rt.members()).toEqual(['acme/app/baz#z', 'acme/app/bar#b'])
    expect(edges(rt)).toEqual(['acme/app/bar#b -> acme/app/baz#z live'])
  })
  test('a single provider is made and connected, recursively', async () => {
    const rt = setup()
    expect(await rt.create('f', 'acme/app/foo', { provision: true })).toEqual(success({ coord: 'acme/app/foo#f', unsatisfied: [] }))
    expect(rt.members()).toEqual(['acme/app/foo#f', 'acme/app/bar#bar-1', 'acme/app/baz#baz-1'])
    expect(edges(rt)).toEqual(['acme/app/bar#bar-1 -> acme/app/baz#baz-1 live', 'acme/app/foo#f -> acme/app/bar#bar-1 live'])
  })
  test('a made instance takes the first free id', async () => {
    const rt = setup()
    await rt.create('bar-1', 'acme/db/mem')
    await rt.create('f', 'acme/app/foo', { provision: true })
    expect(rt.members()).toContain('acme/app/bar#bar-2')
  })
  test('a made instance skips ids taken elsewhere in the application', async () => {
    const rt = setup(undefined, id => id === 'bar-1')
    await rt.create('f', 'acme/app/foo', { provision: true })
    expect(rt.members()).toContain('acme/app/bar#bar-2')
  })
  test('two matching implementations leave it unsatisfied with `2 match`', async () => {
    const rt = setup()
    expect(await rt.create('u', 'acme/app/user', { provision: true })).toEqual(success({ coord: 'acme/app/user#u', unsatisfied: [{ role: 'store', reason: '2 match' }] }))
    expect(rt.members()).toEqual(['acme/app/user#u'])
  })
  test('two matching members leave it unsatisfied with `2 match`, even when one implementation matches', async () => {
    const rt = setup()
    await rt.create('z1', 'acme/app/baz')
    await rt.create('z2', 'acme/app/baz')
    expect(await rt.create('b', 'acme/app/bar', { provision: true })).toEqual(success({ coord: 'acme/app/bar#b', unsatisfied: [{ role: 'baz', reason: '2 match' }] }))
    expect(rt.subscriptions()).toEqual([])
  })
  test('a dependency already connected is left alone', async () => {
    const rt = setup()
    await rt.create('z1', 'acme/app/baz')
    await rt.create('z2', 'acme/app/baz')
    rt.subscribe({ kind: 'call', from: 'acme/app/bar#b', to: 'acme/app/baz#z2' })
    expect(await rt.create('b', 'acme/app/bar', { provision: true })).toEqual(success({ coord: 'acme/app/bar#b', unsatisfied: [] }))
    expect(edges(rt)).toEqual(['acme/app/bar#b -> acme/app/baz#z2 live'])
  })
  test('a selector naming only tags matches no implementation', async () => {
    const rt = setup()
    expect(await rt.create('t', 'acme/app/tagged', { provision: true })).toEqual(success({ coord: 'acme/app/tagged#t', unsatisfied: [{ role: 'cache', reason: 'nothing matches' }] }))
  })
  test('a selector may name the implementation', async () => {
    const rt = setup()
    expect((await rt.create('i', 'acme/app/by-impl', { provision: true })).ok).toBe(true)
    expect(edges(rt)).toEqual(['acme/app/by-impl#i -> acme/app/baz#baz-1 live'])
  })
  test('mutual dependencies connect both ways', async () => {
    const rt = setup()
    expect(await rt.create('a', 'acme/cyc/a', { provision: true })).toEqual(success({ coord: 'acme/cyc/a#a', unsatisfied: [] }))
    expect(rt.members()).toEqual(['acme/cyc/a#a', 'acme/cyc/b#b-1'])
    expect(edges(rt)).toEqual(['acme/cyc/b#b-1 -> acme/cyc/a#a live', 'acme/cyc/a#a -> acme/cyc/b#b-1 live'])
    expect(await contexts.get('acme/cyc/a#a')!.one(CycB, b => b.ping('to b'))).toEqual(success('to b'))
    expect(await contexts.get('acme/cyc/b#b-1')!.one(CycA, a => a.ping('to a'))).toEqual(success('to a'))
  })
  test('a longer loop connects, making each implementation at most once per pass', async () => {
    const rt = setup()
    expect(await rt.create('r', 'acme/loop/r', { provision: true })).toEqual(success({ coord: 'acme/loop/r#r', unsatisfied: [] }))
    expect(rt.members()).toEqual(['acme/loop/r#r', 'acme/loop/a#a-1', 'acme/loop/d#d-1', 'acme/loop/b#b-1', 'acme/loop/c#c-1'])
    expect(edges(rt)).toEqual([
      'acme/loop/a#a-1 -> acme/loop/d#d-1 live',
      'acme/loop/c#c-1 -> acme/loop/b#b-1 live',
      'acme/loop/c#c-1 -> acme/loop/d#d-1 live',
      'acme/loop/b#b-1 -> acme/loop/c#c-1 live',
      'acme/loop/a#a-1 -> acme/loop/b#b-1 live',
      'acme/loop/r#r -> acme/loop/a#a-1 live',
    ])
  })
  test('calls during the pass wait for it, then get the real result', async () => {
    const rt = setup()
    await rt.create('e', 'acme/loop/eager', { provision: true })
    expect(await early.get('acme/loop/eager#e')).toEqual(success('hi'))
  })
  test('a policy that throws while provisioning subscribes is a denial with its error', async () => {
    const rt = setup({ isAllowed: (_f, to) => { if (to.startsWith('acme/app/baz')) throw new Error('bad policy'); return { approved: true } } })
    await rt.create('z', 'acme/app/baz')
    expect(await rt.create('b', 'acme/app/bar', { provision: true })).toEqual(success({ coord: 'acme/app/bar#b', unsatisfied: [{ role: 'baz', reason: 'policy threw: bad policy' }] }))
  })
  test('a nested create that fails (here one named by provider) leaves the role unsatisfied with its reason; the instance still exists', async () => {
    const rt = setup()
    expect(await rt.create('n', 'acme/app/needs-boom', { provision: true })).toEqual(success({
      coord: 'acme/app/needs-boom#n', unsatisfied: [{ role: 'boom', reason: 'acme/bad/boom#boom-1: nope' }],
    }))
    expect(rt.members()).toEqual(['acme/app/needs-boom#n'])
  })
  test('a subscription the policy denies leaves the role unsatisfied with the reason', async () => {
    const rt = setup({ isAllowed: (_f, to) => (to.startsWith('acme/app/baz') ? { approved: false, reason: 'no baz' } : { approved: true }) })
    await rt.create('z', 'acme/app/baz')
    expect(await rt.create('b', 'acme/app/bar', { provision: true })).toEqual(success({ coord: 'acme/app/bar#b', unsatisfied: [{ role: 'baz', reason: 'no baz' }] }))
  })
  test('a throwing policy on a plain subscribe is a denial, observed', () => {
    const seen: unknown[] = []
    const rt = createRuntime('r1', { registry: createRegistry(), policy: { isAllowed: () => { throw new Error('bad policy') } }, pod: { observe: o => seen.push(o) } })
    expect(rt.subscribe({ kind: 'call', from: 'acme/app/bar#b', to: 'acme/app/baz#z' })).toEqual({ ok: false, fail: { type: 'denied', reason: 'policy threw: bad policy' } })
    expect(seen).toEqual([{ kind: 'exception', instance: 'acme/app/bar#b', op: 's1', error: 'policy threw: bad policy' }])
    expect(rt.subscriptions()).toEqual([])
  })
  test('`provision: false` makes nothing', async () => {
    const rt = setup()
    expect(await rt.create('f', 'acme/app/foo', { provision: false })).toEqual(success({ coord: 'acme/app/foo#f', unsatisfied: [{ role: 'bar', reason: 'not provisioned' }] }))
    expect(await rt.create('g', 'acme/app/foo')).toEqual(success({ coord: 'acme/app/foo#g', unsatisfied: [{ role: 'bar', reason: 'not provisioned' }] }))
    expect(rt.members()).toEqual(['acme/app/foo#f', 'acme/app/foo#g'])
    expect(rt.subscriptions()).toEqual([])
  })
})
