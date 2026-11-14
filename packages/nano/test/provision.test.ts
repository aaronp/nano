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
import { Pod } from '../src/pod.ts'
import { createRuntime, type Runtime } from '../src/runtime/index.ts'

const Str = defineSchema('Str', Type.String())
const face = (coord: string) => iface(coord, { ping: op.action('ping', Str, Str) })
const Foo = face('acme/foo'), Bar = face('acme/bar'), Baz = face('acme/baz'), DB = face('acme/db'), CycA = face('acme/cyc-a'), CycB = face('acme/cyc-b')
const Probe = iface('acme/probe', { probe: op.action('probe', Str, Str) })

/** Contexts are made by a runtime per invocation: the probe keeps the last one it was given. */
let caught: NanoContext | undefined
const probe = provide(Probe, { probe: async c => { caught = c; return success('') } })
async function ctxOf(rt: Runtime, coord: string): Promise<NanoContext> {
  await rt.call(coord).probe('')
  return caught!
}
const impl = (coord: string, provides: Interface[], dependencies: Record<string, Selector> = {}): Implementation =>
  implementation(coord, { provides: [...provides, Probe], dependencies, make: () => [probe, ...provides.map(i => provide(i, { ping: async (_c, s) => success(s) }))] })

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
const boom = implementation('acme/bad/boom', { provides: [], make: () => { throw new Error('nope') } })

function setup(policy?: Policy) {
  const registry = createRegistry()
  for (const p of [
    provider('acme/app', [foo, bar, baz, user, tagged, byImpl, needsBoom]),
    provider('acme/db', [impl('acme/db/mem', [DB]), impl('acme/db/file', [DB])]),
    provider('acme/cyc', [cycA, cycB]),
    provider('acme/bad', [boom]),
    provider('acme/loop', [loopR, loopA, loopB, loopC, loopD]),
  ]) registry.add(p)
  const rt = createRuntime('r1', { registry, ...(policy && { policy }) })
  /** Register a new pod of `implementation`: its coord. */
  const add = (implementation: string) => { const r = rt.register(Pod.create(registry.implementation(implementation)!)); if (!r.ok) throw new Error(r.fail.reason); return r.value }
  return { rt, add }
}
const edges = (rt: Runtime) => rt.subscriptions().map(s => `${s.from} -> ${s.to} ${rt.status(s.id)}`)
const settle = () => new Promise(r => setTimeout(r, 0))
const none = success([])

describe('provisioning', () => {
  test('registering makes nothing: provisioning is asked for', () => {
    const { rt, add } = setup()
    add('acme/app/foo')
    expect(rt.pods()).toEqual(['acme/app/foo#0'])
    expect(rt.subscriptions()).toEqual([])
  })
  test('an unknown coord fails not-found', () => {
    expect(setup().rt.provision('acme/app/foo#0')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('an existing single match is connected, nothing is made', () => {
    const { rt, add } = setup()
    add('acme/app/baz')
    expect(rt.provision(add('acme/app/bar'))).toEqual(none)
    expect(rt.pods()).toEqual(['acme/app/baz#0', 'acme/app/bar#0'])
    expect(edges(rt)).toEqual(['acme/app/bar#0 -> acme/app/baz#0 live'])
  })
  test('a single implementation is made, registered and connected, recursively, in the same turn', () => {
    const { rt, add } = setup()
    expect(rt.provision(add('acme/app/foo'))).toEqual(none)
    expect(rt.pods()).toEqual(['acme/app/foo#0', 'acme/app/bar#0', 'acme/app/baz#0'])
    expect(edges(rt)).toEqual(['acme/app/bar#0 -> acme/app/baz#0 live', 'acme/app/foo#0 -> acme/app/bar#0 live'])
  })
  test('two matching implementations leave it unsatisfied with `2 match`', () => {
    const { rt, add } = setup()
    expect(rt.provision(add('acme/app/user'))).toEqual(success([{ role: 'store', reason: '2 match' }]))
    expect(rt.pods()).toEqual(['acme/app/user#0'])
  })
  test('two matching pods leave it unsatisfied with `2 match`, even when one implementation matches', () => {
    const { rt, add } = setup()
    add('acme/app/baz'); add('acme/app/baz')
    expect(rt.provision(add('acme/app/bar'))).toEqual(success([{ role: 'baz', reason: '2 match' }]))
    expect(rt.subscriptions()).toEqual([])
  })
  test('a dependency already connected is left alone', () => {
    const { rt, add } = setup()
    add('acme/app/baz'); add('acme/app/baz')
    rt.subscribe({ kind: 'call', from: 'acme/app/bar#0', to: 'acme/app/baz#1' })
    expect(rt.provision(add('acme/app/bar'))).toEqual(none)
    expect(edges(rt)).toEqual(['acme/app/bar#0 -> acme/app/baz#1 live'])
  })
  test('a selector naming only tags matches no implementation', () => {
    const { rt, add } = setup()
    expect(rt.provision(add('acme/app/tagged'))).toEqual(success([{ role: 'cache', reason: 'nothing matches' }]))
  })
  test('a selector may name the implementation', () => {
    const { rt, add } = setup()
    expect(rt.provision(add('acme/app/by-impl'))).toEqual(none)
    expect(edges(rt)).toEqual(['acme/app/by-impl#0 -> acme/app/baz#0 live'])
  })
  test('mutual dependencies connect both ways', async () => {
    const { rt, add } = setup()
    const a = add('acme/cyc/a'), b = 'acme/cyc/b#0'
    expect(rt.provision(a)).toEqual(none)
    expect(rt.pods()).toEqual([a, b])
    expect(edges(rt)).toEqual([`${b} -> ${a} live`, `${a} -> ${b} live`])
    expect(await (await ctxOf(rt, a)).one(CycB, x => x.ping('to b'))).toEqual(success('to b'))
    expect(await (await ctxOf(rt, b)).one(CycA, x => x.ping('to a'))).toEqual(success('to a'))
  })
  test('a longer loop connects, making each implementation at most once per pass', () => {
    const { rt, add } = setup()
    expect(rt.provision(add('acme/loop/r'))).toEqual(none)
    expect(rt.pods()).toEqual(['r', 'a', 'd', 'b', 'c'].map(x => `acme/loop/${x}#0`))
    expect(edges(rt).map(e => e.replaceAll('acme/loop/', '').replaceAll('#0', ''))).toEqual([
      'a -> d live',
      'c -> b live',
      'c -> d live',
      'b -> c live',
      'a -> b live',
      'r -> a live',
    ])
  })
  test('a policy that throws while provisioning subscribes is a denial with its error', () => {
    const { rt, add } = setup({ isAllowed: (_f, to) => { if (to === 'acme/app/baz#0') throw new Error('bad policy'); return { approved: true } } })
    add('acme/app/baz')
    expect(rt.provision(add('acme/app/bar'))).toEqual(success([{ role: 'baz', reason: 'policy threw: bad policy' }]))
  })
  test('a subscription the policy denies leaves the role unsatisfied with the reason', () => {
    const { rt, add } = setup({ isAllowed: (_f, to) => (to === 'acme/app/baz#0' ? { approved: false, reason: 'no baz' } : { approved: true }) })
    add('acme/app/baz')
    expect(rt.provision(add('acme/app/bar'))).toEqual(success([{ role: 'baz', reason: 'no baz' }]))
  })
  // A starting pod is available: its subscription is live when made, and waits once the make fails.
  test('a made pod (here one named by provider) whose make fails: the subscription is made live, then waits', async () => {
    const { rt, add } = setup()
    expect(rt.provision(add('acme/app/needs-boom'))).toEqual(none)
    expect(rt.pods()).toEqual(['acme/app/needs-boom#0', 'acme/bad/boom#0'])
    await settle()
    expect(rt.pod('acme/bad/boom#0')!.state).toBe('failed')
    expect(edges(rt)).toEqual(['acme/app/needs-boom#0 -> acme/bad/boom#0 waiting'])
  })
  test('an existing failed pod that matches is connected, and the subscription waits', async () => {
    const { rt, add } = setup()
    add('acme/bad/boom')
    await settle()
    expect(rt.provision(add('acme/app/needs-boom'))).toEqual(success([{ role: 'boom', reason: 'subscription s1 to acme/bad/boom#0 is waiting' }]))
    expect(edges(rt)).toEqual(['acme/app/needs-boom#0 -> acme/bad/boom#0 waiting'])
  })
  test('provisioning again keeps a waiting subscription to a match: no duplicate', async () => {
    const { rt, add } = setup()
    add('acme/bad/boom')
    await settle()
    const n = add('acme/app/needs-boom')
    rt.provision(n)
    expect(rt.provision(n)).toEqual(success([{ role: 'boom', reason: 'subscription s1 to acme/bad/boom#0 is waiting' }]))
    expect(edges(rt)).toEqual(['acme/app/needs-boom#0 -> acme/bad/boom#0 waiting'])
  })
})
