// @ts-nocheck — the effect-pod revision isn't built yet; remove when it lands
/**
 * The effect-pod revision, written first (spec: "The pod is the effect boundary"). A pod is standalone around one
 * instance of one implementation; registering it gives it `<implementation>#<n>` in a runtime; only a runtime makes a
 * `NanoContext`, so every call is policed and recorded on the stream of the runtime it travels through. A handler's
 * onward calls search its pod's subscriptions in every runtime the pod is in (sharing is registering; no gateways).
 */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import * as nano from '../src/index.ts'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, type Interface } from '../src/iface.ts'
import { success, type NanoResult } from '../src/result.ts'
import { implementation, provide, type Handler } from '../src/implementation.ts'
import { provider } from '../src/provider.ts'
import { createRegistry } from '../src/registry.ts'
import type { Policy } from '../src/policy.ts'
import { createRuntime, type RuntimeEvent } from '../src/runtime/index.ts'
import { createApplication } from '../src/application.ts'

// Not exported yet: read off the module so this file still loads while every test is todo.
const { Pod } = nano as unknown as { Pod: { create(i: unknown, opts?: { config?: unknown }): any } }

const Str = defineSchema('Str', Type.String())
const face = (coord: string) => iface(coord, { ping: op.action('ping', Str, Str) })
const Vault = face('acme/vault'), Signer = face('acme/signer'), Tester = face('acme/tester')

const echo = (prefix: string): Handler => async (_c, s) => success(`${prefix} ${s}`)
/** An implementation whose instance answers ping with `<config> <input>`; make receives the config, no ctx. */
const echoing = (coord: string, provides: Interface[]) =>
  implementation(coord, { provides, make: (config: unknown) => provides.map(i => provide(i, { ping: echo(String(config)) })) })
const vault = echoing('acme/keys/vault', [Vault])
const user = echoing('acme/ui/user', [Tester])
// One counter per instance: the same instance answers 1, 2, 3 …
const counter = implementation('acme/keys/counter', { provides: [Vault], make: () => { let n = 0; return [provide(Vault, { ping: async () => success(String(++n)) })] } })
// The signer calls the vault beside it through the ctx it was invoked with.
const sign: Handler = async (ctx, s) => {
  const r: NanoResult<string> = await ctx.one(Vault, v => v.ping(s as string))
  return r.ok ? success(`signed ${r.value}`) : r
}
const signer = implementation('acme/keys/signer', { provides: [Signer], dependencies: { vault: Vault }, make: () => [provide(Signer, { ping: sign })] })
// The tester calls whatever signer it is connected to.
const tester = implementation('acme/ui/tester', { provides: [Tester], dependencies: { signer: Signer }, make: () => [provide(Tester, {
  ping: async (ctx, s) => ctx.one(Signer, sg => sg.ping(s as string)),
})] })
// Its make throws while config says so.
const flaky = implementation('acme/keys/flaky', { provides: [Vault], make: (config: { fail?: boolean } = {}) => {
  if (config.fail) throw new Error('vault down')
  return [provide(Vault, { ping: echo('flaky') })]
} })
// An instance made with config 'old' holds every ping until the test opens the gate: a call in flight.
let openGate = () => {}
const gated = implementation('acme/keys/gated', { provides: [Vault], make: (config: unknown) => [provide(Vault, { ping: async (_c, s) => {
  if (config === 'old') await new Promise<void>(r => { openGate = r })
  return success(`${config} ${s}`)
} })] })
const thrower = implementation('acme/keys/thrower', { provides: [Vault], make: () => [provide(Vault, { ping: async () => { throw new Error('bang') } })] })

const registry = () => {
  const r = createRegistry()
  r.add(provider('acme/keys', [vault, counter, signer, flaky, gated, thrower]))
  r.add(provider('acme/ui', [user, tester]))
  return r
}
/** A runtime and everything on its stream. */
const runtime = (id = 'r1', policy?: Policy) => {
  const rt = createRuntime(id, { registry: registry(), ...(policy && { policy }) })
  const events: RuntimeEvent[] = []
  rt.listen(e => events.push(e))
  return { rt, events }
}
const reg = (rt, pod): string => { const r = rt.register(pod); if (!r.ok) throw new Error(r.fail.reason); return r.value }
const settle = () => new Promise(r => setTimeout(r, 0))
/** sent → delivered pairs on a stream, as `to` and result. */
const delivered = (events: RuntimeEvent[]) => events.filter(e => e.type === 'sent').map(s => ({
  to: s.to, result: events.find(e => e.type === 'delivered' && e.id === s.id)?.result,
}))

describe('registering', () => {
  // Behaviour 1.
  test.todo('given two pods of one implementation, when the first is unregistered and another registered, then the coords are #0, #1 and #2, never a reused #0', async () => {
    const { rt } = runtime()
    expect(rt.register(Pod.create(vault))).toEqual(success('acme/keys/vault#0'))
    expect(rt.register(Pod.create(vault))).toEqual(success('acme/keys/vault#1'))
    expect(rt.unregister('acme/keys/vault#0')).toEqual(success(undefined))
    expect(rt.register(Pod.create(vault))).toEqual(success('acme/keys/vault#2'))
  })
  // Behaviour 2.
  test.todo('given one pod registered in two runtimes, when called through each, then each has its own coord and both reach the same instance', async () => {
    const a = runtime('a').rt, b = runtime('b').rt
    const pod = Pod.create(counter)
    const inA = reg(a, pod), inB = reg(b, pod)
    expect([inA, inB]).toEqual(['acme/keys/counter#0', 'acme/keys/counter#0'])
    expect(await a.call(inA).ping('x')).toEqual(success('1'))
    expect(await b.call(inB).ping('x')).toEqual(success('2'))
  })
  test.todo('given an unknown coord, when it is called or unregistered, then it fails not-found', async () => {
    const { rt } = runtime()
    expect(await rt.call('acme/keys/vault#0').ping('x')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(rt.unregister('acme/keys/vault#0')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
})

describe('a pod', () => {
  test.todo('given an implementation and config, when a pod is created, then it names the implementation, runs, and its instance is made from that config', async () => {
    const pod = Pod.create(vault, { config: 'eu' })
    await settle()
    expect(pod.implementation).toBe('acme/keys/vault')
    expect(pod.state).toBe('running')
    const { rt } = runtime()
    expect(await rt.call(reg(rt, pod)).ping('x')).toEqual(success('eu x'))
  })
  // Behaviour 3.
  test.todo('given a subscribed pod with a call in flight, when it is swapped, then the subscription stays live, the next call reaches the new instance and the call in flight finishes on the old one', async () => {
    const { rt } = runtime()
    const pod = Pod.create(gated, { config: 'old' })
    const g = reg(rt, pod), u = reg(rt, Pod.create(user))
    const sub = rt.subscribe({ kind: 'call', from: u, to: g })
    const inFlight = rt.call(g).ping('a')
    await settle()
    expect(await pod.swap({ config: 'new' })).toEqual(success(undefined))
    expect(rt.status(sub.value.id)).toBe('live')
    expect(await rt.call(g).ping('b')).toEqual(success('new b'))
    openGate()
    expect(await inFlight).toEqual(success('old a'))
    expect(rt.subscriptions()).toEqual([sub.value])
  })
  test.todo('given a disposed pod, when it is swapped, then the swap fails', async () => {
    const pod = Pod.create(vault)
    await pod.dispose()
    expect(await pod.swap({ config: 'new' })).toMatchObject({ ok: false })
  })
  test.todo('given a handler that throws, when it is called through a runtime, then the call is a Fail threw and the pod keeps running', async () => {
    const { rt, events } = runtime()
    const pod = Pod.create(thrower)
    const c = reg(rt, pod)
    expect(await rt.call(c).ping('x')).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(pod.state).toBe('running')
    expect(events).toContainEqual(expect.objectContaining({ type: 'failure' }))
  })
})

describe('only a runtime calls a pod', () => {
  // Behaviour 4: no ctx, no call. A NanoContext comes only from a runtime.
  test.todo('given a pod, when it is invoked without a context, then it does not type-check', () => {
    const bypass = (pod: ReturnType<typeof Pod.create>) => {
      // @ts-expect-error — invoke needs a ctx, and only a runtime makes one
      pod.invoke('port', 'x')
      // @ts-expect-error — the typed sugar needs one too
      pod.call.ping('x')
    }
    expect(typeof Pod?.create).toBe('function')
  })
  // Behaviour 4: every call via rt.call is on that runtime's stream.
  test.todo('given a runtime, when a host calls a pod through it, then every call appears on its stream as sent then delivered', async () => {
    const { rt, events } = runtime()
    const c = reg(rt, Pod.create(vault, { config: 'v' }))
    await rt.call(c).ping('a')
    await rt.call(c).ping('b')
    expect(delivered(events)).toEqual([{ to: c, result: success('v a') }, { to: c, result: success('v b') }])
  })
  test.todo('given a policy that refuses the pod, when a host calls it through the runtime, then the call is denied and recorded as denied', async () => {
    const { rt, events } = runtime('r1', { isAllowed: (_f, t) => ({ approved: false, reason: `no ${t}` }) })
    const c = reg(rt, Pod.create(vault))
    expect(await rt.call(c).ping('x')).toMatchObject({ ok: false, fail: { type: 'denied' } })
    const sent = events.find(e => e.type === 'sent')
    expect(events).toContainEqual(expect.objectContaining({ type: 'denied', id: sent.id }))
  })
  // Behaviour 5.
  test.todo("given one signer pod in R and other with its vault subscription only in R, when called through other, then its vault call goes through R and is recorded only there", async () => {
    const r = runtime('R'), other = runtime('other')
    const pod = Pod.create(signer)
    const s = reg(r.rt, pod), v = reg(r.rt, Pod.create(vault, { config: 'v' }))
    r.rt.subscribe({ kind: 'call', from: s, to: v })
    const elsewhere = reg(other.rt, pod)
    expect(await other.rt.call(elsewhere).ping('x')).toEqual(success('signed v x'))
    expect(delivered(other.events).map(d => d.to)).toEqual([elsewhere])
    expect(delivered(r.events).map(d => d.to)).toEqual([v])
  })
  // Behaviour 5: a match in two runtimes.
  test.todo('given a signer pod wired to a vault in each of two runtimes, when its handler calls one vault, then the call is ambiguous', async () => {
    const a = runtime('a'), b = runtime('b')
    const pod = Pod.create(signer)
    const sa = reg(a.rt, pod), va = reg(a.rt, Pod.create(vault, { config: 'a' }))
    const sb = reg(b.rt, pod), vb = reg(b.rt, Pod.create(vault, { config: 'b' }))
    a.rt.subscribe({ kind: 'call', from: sa, to: va })
    b.rt.subscribe({ kind: 'call', from: sb, to: vb })
    expect(await a.rt.call(sa).ping('x')).toMatchObject({ ok: false, fail: { type: 'ambiguous' } })
  })
})

describe('the runtimes a pod is in', () => {
  // Behaviour 6 (the full story is examples/messenger/send.test.ts).
  test.todo("given a pod registered in three runtimes and unregistered from one, then its runtimes and its handlers' ctx.runtimes name the other two", async () => {
    let seen: string[] = []
    const where = implementation('acme/keys/where', { provides: [Vault], make: () => [provide(Vault, { ping: async ctx => { seen = ctx.runtimes; return success('ok') } })] })
    const rts = ['messaging', 'chat', 'support'].map(id => { const registry = createRegistry(); registry.add(provider('acme/keys', [where])); return createRuntime(id, { registry }) })
    const pod = Pod.create(where)
    const coords = rts.map(rt => reg(rt, pod))
    expect(pod.runtimes).toEqual(['messaging', 'chat', 'support'])
    expect(rts[1].unregister(coords[1])).toEqual(success(undefined))
    expect(pod.runtimes).toEqual(['messaging', 'support'])
    await rts[2].call(coords[2]).ping('x')
    expect(seen).toEqual(['messaging', 'support'])
  })
})

describe('unregistering', () => {
  // Behaviour 7.
  test.todo('given a pod in two runtimes with a subscription to it in each, when unregistered from one, then only that runtime’s subscription is deleted', async () => {
    const a = runtime('a'), b = runtime('b')
    const pod = Pod.create(vault, { config: 'v' })
    const inA = reg(a.rt, pod), inB = reg(b.rt, pod)
    const ua = reg(a.rt, Pod.create(user)), ub = reg(b.rt, Pod.create(user))
    const sa = a.rt.subscribe({ kind: 'call', from: ua, to: inA }).value, sb = b.rt.subscribe({ kind: 'call', from: ub, to: inB }).value
    expect(a.rt.unregister(inA)).toEqual(success(undefined))
    expect(a.rt.subscriptions()).toEqual([])
    expect(a.events).toContainEqual({ type: 'subscription-removed', id: sa.id, reason: 'cascade' })
    expect(b.rt.subscriptions()).toEqual([sb])
    expect(b.rt.status(sb.id)).toBe('live')
    expect(await b.rt.call(inB).ping('x')).toEqual(success('v x'))
  })
})

describe('failure', () => {
  // Behaviour 8.
  test.todo('given a pod whose instance fails to make, when subscribed to and then swapped with a working config, then it is failed, the subscription waits, and then goes live', async () => {
    const { rt } = runtime()
    const pod = Pod.create(flaky, { config: { fail: true } })
    await settle()
    expect(pod.state).toBe('failed')
    const f = reg(rt, pod), u = reg(rt, Pod.create(user))
    const sub = rt.subscribe({ kind: 'call', from: u, to: f }).value
    expect(rt.status(sub.id)).toBe('waiting')
    expect(await pod.swap({ config: { fail: false } })).toEqual(success(undefined))
    expect(pod.state).toBe('running')
    expect(rt.status(sub.id)).toBe('live')
  })
  // Behaviour 9. Saved form (spec): pods as { coord, implementation, config }, `next` per implementation.
  test.todo('given a saved runtime whose pod fails to make, when it is started, then the runtime starts and that pod is failed', async () => {
    const app = createApplication('app', { registry: registry() })
    const F = 'acme/keys/flaky#0', U = 'acme/ui/user#0'
    app.define({
      id: 'r',
      pods: [{ coord: F, implementation: 'acme/keys/flaky', config: { fail: true } }, { coord: U, implementation: 'acme/ui/user' }],
      next: { 'acme/keys/flaky': 1, 'acme/ui/user': 1 },
      subscriptions: [{ id: 's1', kind: 'call', from: U, to: F }],
    })
    const r = await app.start('r')
    expect(r.ok).toBe(true)
    expect(r.value.status('s1')).toBe('waiting')
    expect(await r.value.call(F).ping('x')).toMatchObject({ ok: false, fail: { type: 'missing' } })
    expect(await r.value.call(U).ping('x')).toMatchObject({ ok: true })
  })
})
