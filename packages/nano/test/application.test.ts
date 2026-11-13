import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { defineSchema } from '../src/schema.ts'
import { op } from '../src/op.ts'
import { iface, portKey, type Interface } from '../src/iface.ts'
import { success, type NanoResult } from '../src/result.ts'
import { implementation, provide, type Handler, type Implementation } from '../src/implementation.ts'
import { provider } from '../src/provider.ts'
import { createRegistry } from '../src/registry.ts'
import type { Policy } from '../src/policy.ts'
import type { NanoContext } from '../src/context.ts'
import type { Selector } from '../src/selector.ts'
import type { RuntimeEvent } from '../src/runtime/index.ts'
import { createApplication, type RuntimeDef } from '../src/application.ts'

const Str = defineSchema('Str', Type.String())
const face = (coord: string) => iface(coord, { ping: op.action('ping', Str, Str) })
const Vault = face('acme/vault'), Signer = face('acme/signer'), Slow = face('acme/slow'), Sink = face('acme/sink')
const Ticks = iface('acme/ticks', { tick: op.source('tick', Str) })
const TICK = portKey(Ticks.coord, Ticks.ops.tick.coord), PING = (i: Interface) => portKey(i.coord, Signer.ops.ping.coord)

const contexts = new Map<string, NanoContext>()
const echo: Handler = async (_c, s) => success(s)
const impl = (coord: string, provides: Interface[], dependencies: Record<string, Selector> = {}, ping: Handler = echo, wait = 0): Implementation =>
  implementation(coord, {
    provides, dependencies,
    make: async ctx => {
      contexts.set(ctx.instance, ctx)
      if (wait) await new Promise(r => setTimeout(r, wait))
      return provides.map(i => provide(i, { ping }))
    },
  })
// The signer calls the vault beside it, through its own context: its home runtime's subscriptions.
const sign: Handler = async (ctx, s) => {
  const r: NanoResult<string> = await ctx.one(Vault, v => v.ping(s as string))
  return r.ok ? success(`signed ${r.value}`) : r
}
const vault = impl('acme/keys/vault', [Vault])
const signer = impl('acme/keys/signer', [Signer], { vault: Vault }, sign)
const slow = impl('acme/keys/slow', [Slow], {}, echo, 10)
const holder = impl('acme/keys/holder', [], { vault: Vault, slow: Slow }) // a pass: the vault joins, then a slow make holds it open
const tester = impl('acme/ui/tester', [], { signer: Signer })
const user = impl('acme/ui/user', [], { vault: Vault })
const cached = impl('acme/ui/cached', [], { cache: { tags: ['cache'] } })
const signer2 = impl('acme/keys/signer2', [Signer], { vault: Vault }, sign)
const ticker = impl('acme/keys/ticker', [Ticks]), ticker2 = impl('acme/keys/ticker2', [Ticks])
const boom = implementation('acme/keys/boom', { provides: [Signer], make: () => { throw new Error('boom') } })
const heard: string[] = []
const sink = impl('acme/ui/sink', [Sink], {}, async (_c, s) => { heard.push(s as string); return success(s) })

const registry = () => {
  const r = createRegistry()
  r.add(provider('acme/keys', [vault, signer, slow, holder, signer2, ticker, ticker2, boom]))
  r.add(provider('acme/ui', [tester, user, cached, sink]))
  return r
}
const recording = (log: string[]): Policy => ({ isAllowed: (f, t) => { log.push(`${f} -> ${t}`); return { approved: true } } })
const S = 'acme/keys/signer#s', V = 'acme/keys/vault#v', T = 'acme/ui/tester#t'

/** A `signer` runtime holding the vault and the signer (signer → vault), and an empty `client` runtime. */
async function setup(policies: { signer?: Policy; client?: Policy } = {}) {
  const app = createApplication('app', { registry: registry() })
  const sr = app.createRuntime('signer', { ...(policies.signer && { policy: policies.signer }) })
  const cr = app.createRuntime('client', { ...(policies.client && { policy: policies.client }) })
  if (!sr.ok || !cr.ok) throw new Error('setup')
  await sr.value.create('v', 'acme/keys/vault')
  await sr.value.create('s', 'acme/keys/signer', { provision: true })
  return { app, signerRt: sr.value, client: cr.value }
}

describe('placing', () => {
  test('a placed instance is a member of both, and announced only where it arrives, with its home', async () => {
    const { app, signerRt, client } = await setup()
    const inSigner: RuntimeEvent[] = [], inClient: RuntimeEvent[] = []
    signerRt.listen(e => inSigner.push(e)); client.listen(e => inClient.push(e))
    expect(app.place(S, 'signer', 'client')).toEqual(success(undefined))
    expect(signerRt.members()).toContain(S)
    expect(client.member(S)).toMatchObject({ coord: S, home: 'signer', pod: signerRt.member(S)!.pod })
    expect(inSigner).toEqual([])
    expect(inClient).toEqual([{ type: 'instance-added', instance: S, home: 'signer' }])
  })
  test('calls into it are policed by the runtime they happen in', async () => {
    const signerLog: string[] = [], clientLog: string[] = []
    const { app, client } = await setup({ signer: recording(signerLog), client: recording(clientLog) })
    app.place(S, 'signer', 'client')
    await client.create('t', 'acme/ui/tester', { provision: true })
    signerLog.length = 0; clientLog.length = 0
    expect(await contexts.get(T)!.one(Signer, s => s.ping('x'))).toEqual(success('signed x'))
    expect(clientLog).toEqual([`${T} -> ${S}`])
    expect(signerLog).toEqual([`${S} -> ${V}`])
  })
  test('a placed instance calls out through its home runtime\'s subscriptions', async () => {
    const { app, signerRt, client } = await setup()
    app.place(S, 'signer', 'client')
    await client.create('t', 'acme/ui/tester', { provision: true })
    await contexts.get(T)!.one(Signer, s => s.ping('x'))
    expect(client.subscriptions().map(s => `${s.from} -> ${s.to}`)).toEqual([`${T} -> ${S}`])
    const home = signerRt.subscriptions().find(s => s.from === S)!
    expect(signerRt.books(home.id)).toEqual({ calls: 1, last: success('x') })
  })
  test('placing needs the instance in `from` and an approving `to`', async () => {
    const { app, client } = await setup({ client: { isAllowed: (f, t, d) => (d === S ? { approved: false, reason: `no ${f} -> ${t}` } : { approved: true }) } })
    expect(app.place('acme/keys/vault#nope', 'signer', 'client')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(app.place(S, 'client', 'signer')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(app.place(S, 'signer', 'elsewhere')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(app.place(S, 'signer', 'client')).toEqual({ ok: false, fail: { type: 'denied', reason: 'no signer -> client' } })
    expect(client.members()).toEqual([])
  })
  test('removing it at home removes it everywhere; subscriptions to it wait', async () => {
    const { app, signerRt, client } = await setup()
    app.place(S, 'signer', 'client')
    await client.create('t', 'acme/ui/tester', { provision: true })
    const sid = client.subscriptions()[0]!.id
    expect(client.status(sid)).toBe('live')
    expect(signerRt.remove(S)).toEqual(success(undefined))
    expect(client.members()).toEqual([T])
    expect(client.status(sid)).toBe('waiting')
    expect(await contexts.get(T)!.one(Signer, s => s.ping('x'))).toMatchObject({ ok: false, fail: { type: 'missing-component' } })
  })
  test('removing it from a runtime it was placed into leaves its home alone', async () => {
    const { app, signerRt, client } = await setup()
    app.place(S, 'signer', 'client')
    const inSigner: RuntimeEvent[] = [], inClient: RuntimeEvent[] = []
    signerRt.listen(e => inSigner.push(e)); client.listen(e => inClient.push(e))
    client.remove(S)
    expect(inSigner).toEqual([])
    expect(inClient).toEqual([{ type: 'instance-removed', instance: S }])
    expect(signerRt.members()).toEqual([V, S])
    expect(await signerRt.member(S)!.pod.invoke(portKey(Signer.coord, Signer.ops.ping.coord), 'y')).toEqual(success('signed y'))
  })
  test('a call in another runtime into an instance of an unfinished pass at its home waits for the pass', async () => {
    const { app, client } = await setup()
    const home = app.createRuntime('home')
    if (!home.ok) throw new Error('home')
    const order: string[] = []
    const pass = home.value.create('h', 'acme/keys/holder', { provision: true }).then(() => order.push('pass'))
    await new Promise(r => setTimeout(r, 2))
    expect(app.place('acme/keys/vault#vault-1', 'home', 'client')).toEqual(success(undefined))
    await client.create('u', 'acme/ui/user')
    client.subscribe({ kind: 'call', from: 'acme/ui/user#u', to: 'acme/keys/vault#vault-1' })
    const call = contexts.get('acme/ui/user#u')!.one(Vault, v => v.ping('x')).then(r => { order.push('call'); return r })
    await pass
    expect(await call).toEqual(success('x'))
    expect(order).toEqual(['pass', 'call'])
  })
  test('a call waiting for a pass whose subscription goes meanwhile fails not-found and is not delivered', async () => {
    const { app, client } = await setup()
    const home = app.createRuntime('home')
    if (!home.ok) throw new Error('home')
    const pass = home.value.create('h', 'acme/keys/holder', { provision: true })
    await new Promise(r => setTimeout(r, 2))
    app.place('acme/keys/vault#vault-1', 'home', 'client')
    await client.create('u', 'acme/ui/user')
    const sub = client.subscribe({ kind: 'call', from: 'acme/ui/user#u', to: 'acme/keys/vault#vault-1' })
    const call = contexts.get('acme/ui/user#u')!.one(Vault, v => v.ping('x'))
    await Promise.resolve()
    if (sub.ok) client.unsubscribe(sub.value.id)
    await pass
    expect(await call).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('a call subscription from a member placed here is broken: it calls out through its home', async () => {
    const { app, client } = await setup()
    app.place(S, 'signer', 'client'); app.place(V, 'signer', 'client')
    const s = client.subscribe({ kind: 'call', from: S, to: V })
    expect(s.ok && client.status(s.value.id)).toBe('broken')
  })
  test('an event delivered in another runtime into an instance of an unfinished pass at its home waits for the pass', async () => {
    const { app, client } = await setup()
    const home = app.createRuntime('home')
    if (!home.ok) throw new Error('home')
    const order: string[] = []
    const pass = home.value.create('h', 'acme/keys/holder', { provision: true }).then(() => order.push('pass'))
    await new Promise(r => setTimeout(r, 2))
    expect(app.place('acme/keys/vault#vault-1', 'home', 'client')).toEqual(success(undefined))
    await client.create('k', 'acme/keys/ticker')
    client.subscribe({ kind: 'event', from: 'acme/keys/ticker#k', source: TICK, to: 'acme/keys/vault#vault-1', target: PING(Vault) })
    const published = contexts.get('acme/keys/ticker#k')!.publish(Ticks.ops.tick, 'x').then(() => order.push('publish'))
    await Promise.all([pass, published])
    expect(order).toEqual(['pass', 'publish'])
    expect(client.books(client.subscriptions()[0]!.id)).toEqual({ calls: 1, last: success('x') })
  })
})

describe('replacing at home', () => {
  const S2 = 'acme/keys/signer2#s'
  test('a runtime it was placed into swaps the member in place and rewrites its subscriptions', async () => {
    const { app, signerRt, client } = await setup()
    app.place(S, 'signer', 'client')
    await client.create('t', 'acme/ui/tester', { provision: true })
    const events: RuntimeEvent[] = []
    client.listen(e => events.push(e))
    expect(await signerRt.replace(S, 'acme/keys/signer2')).toEqual(success(S2))
    expect(client.members()).toEqual([S2, T])
    expect(client.member(S2)).toMatchObject({ home: 'signer', pod: signerRt.member(S2)!.pod })
    expect(client.subscriptions().map(s => `${s.from} -> ${s.to} ${client.status(s.id)}`)).toEqual([`${T} -> ${S2} live`])
    expect(events[0]).toEqual({ type: 'instance-replaced', from: S, to: S2 })
    expect(await contexts.get(T)!.one(Signer, s => s.ping('x'))).toEqual(success('signed x'))
  })
  test('replacing with the same implementation leaves guests the new pod: calls succeed, subscriptions stay live', async () => {
    const { app, signerRt, client } = await setup()
    app.place(S, 'signer', 'client')
    await client.create('t', 'acme/ui/tester', { provision: true })
    expect(await signerRt.replace(S, 'acme/keys/signer')).toEqual(success(S))
    expect(client.member(S)!.pod).toBe(signerRt.member(S)!.pod)
    expect(client.subscriptions().map(s => client.status(s.id))).toEqual(['live'])
    expect(await contexts.get(T)!.one(Signer, s => s.ping('x'))).toEqual(success('signed x'))
    expect(app.notes()).toEqual([])
  })
  test('publishes of an instance replaced by the same implementation still reach the runtimes it was placed into', async () => {
    const { app, client } = await setup()
    const home = app.createRuntime('home')
    if (!home.ok) throw new Error('home')
    await home.value.create('k', 'acme/keys/ticker')
    app.place('acme/keys/ticker#k', 'home', 'client')
    await client.create('n', 'acme/ui/sink')
    client.subscribe({ kind: 'event', from: 'acme/keys/ticker#k', source: TICK, to: 'acme/ui/sink#n', target: PING(Sink) })
    await home.value.replace('acme/keys/ticker#k', 'acme/keys/ticker')
    heard.length = 0
    await contexts.get('acme/keys/ticker#k')!.publish(Ticks.ops.tick, 'after')
    expect(heard).toEqual(['after'])
  })
  test('a runtime whose policy denies the rewrite keeps its subscriptions waiting on the old coord', async () => {
    const deny: Policy = { isAllowed: (_f, t) => (t === S2 ? { approved: false, reason: 'not the new one' } : { approved: true }) }
    const { app, signerRt, client } = await setup({ client: deny })
    app.place(S, 'signer', 'client')
    await client.create('t', 'acme/ui/tester', { provision: true })
    await signerRt.replace(S, 'acme/keys/signer2')
    expect(client.members()).toEqual([S2, T])
    expect(client.subscriptions().map(s => `${s.from} -> ${s.to} ${client.status(s.id)}`)).toEqual([`${T} -> ${S} waiting`])
    expect(app.notes()).toEqual([`client: following ${S} -> ${S2}: not the new one`])
  })
  test('publishes of the new instance are delivered in the runtimes it was placed into', async () => {
    const { app, client } = await setup()
    const home = app.createRuntime('home')
    if (!home.ok) throw new Error('home')
    await home.value.create('k', 'acme/keys/ticker')
    app.place('acme/keys/ticker#k', 'home', 'client')
    await client.create('n', 'acme/ui/sink')
    client.subscribe({ kind: 'event', from: 'acme/keys/ticker#k', source: TICK, to: 'acme/ui/sink#n', target: PING(Sink) })
    await home.value.replace('acme/keys/ticker#k', 'acme/keys/ticker2')
    heard.length = 0
    await contexts.get('acme/keys/ticker2#k')!.publish(Ticks.ops.tick, 'after')
    expect(heard).toEqual(['after'])
  })
  test('a replaced instance keeps its tags', async () => {
    const { app, signerRt } = await setup()
    app.tag(S, 'primary')
    await signerRt.replace(S, 'acme/keys/signer2')
    expect(app.tagsOf(S2)).toEqual(new Set(['primary']))
    expect(app.tagsOf(S)).toEqual(new Set())
  })
  test('rehome is only for members placed from elsewhere', async () => {
    const { signerRt } = await setup()
    expect(signerRt.rehome(S, signerRt.member(V)!)).toMatchObject({ ok: false, fail: { type: 'denied' } })
    expect(signerRt.rehome('acme/keys/signer#nope', signerRt.member(V)!)).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
})

describe('the application', () => {
  test('is its own root runtime', async () => {
    const app = createApplication('app', { registry: registry() })
    await app.create('v', 'acme/keys/vault')
    expect(app.members()).toEqual([V])
    expect(app.runtime('app')!.members()).toEqual([V])
    expect(app.createRuntime('app')).toMatchObject({ ok: false, fail: { type: 'exists' } })
  })
  test('instance ids are unique across the application', async () => {
    const { app, client } = await setup()
    expect(await client.create('v', 'acme/ui/user')).toMatchObject({ ok: false, fail: { type: 'exists' } })
    expect(await app.create('s', 'acme/ui/user')).toMatchObject({ ok: false, fail: { type: 'exists' } })
  })
  test('an instance id a definition declares is taken before that runtime is opened', async () => {
    const app = createApplication('app', { registry: registry() })
    app.define(signerDef); app.define(clientDef)
    expect(await app.create('t', 'acme/ui/user')).toMatchObject({ ok: false, fail: { type: 'exists' } })
    expect((await app.open('client')).ok).toBe(true)
  })
  test('tags are shared, so a tag selector works in every runtime', async () => {
    const { app, client } = await setup()
    app.tag(V, 'cache')
    expect(app.tagsOf(V)).toEqual(new Set(['cache']))
    app.place(V, 'signer', 'client')
    expect(client.target(V)!.tags).toEqual(new Set(['cache']))
    expect(await client.create('c', 'acme/ui/cached', { provision: true })).toEqual(success({ coord: 'acme/ui/cached#c', unsatisfied: [] }))
    app.untag(V, 'cache')
    expect(client.target(V)!.tags).toEqual(new Set())
  })
  test('tags go when the instance is gone everywhere, not when it leaves a runtime it was placed into', async () => {
    const { app, signerRt, client } = await setup()
    app.tag(V, 'cache')
    app.place(V, 'signer', 'client')
    client.remove(V)
    expect(app.tagsOf(V)).toEqual(new Set(['cache']))
    signerRt.remove(V)
    expect(app.tagsOf(V)).toEqual(new Set())
  })
  test('an application can be adopted as a child of another, keeping its own registry', () => {
    const outer = createApplication('outer', { registry: registry() })
    const inner = createApplication('inner', { registry: registry() })
    expect(outer.adopt(inner)).toEqual(success(undefined))
    expect(outer.runtime('inner')).toBe(inner)
    expect(outer.runtimes()).toEqual(['inner'])
    expect(inner.registry).not.toBe(outer.registry)
    expect(outer.adopt(inner)).toMatchObject({ ok: false, fail: { type: 'exists' } })
  })
})

const signerDef: RuntimeDef = {
  id: 'signer',
  instances: [{ id: 'v', implementation: 'acme/keys/vault' }, { id: 's', implementation: 'acme/keys/signer' }],
  members: [],
  subscriptions: [{ id: 's1', kind: 'call', from: S, to: V }],
}
const clientDef: RuntimeDef = {
  id: 'client',
  policy: 'allow-all',
  instances: [{ id: 't', implementation: 'acme/ui/tester' }],
  members: [{ instance: S, home: 'signer' }],
  subscriptions: [{ id: 's1', kind: 'call', from: T, to: S }],
}

describe('runtimes on demand', () => {
  test('runtimes() lists opened and defined runtimes; definition() gives the data back', () => {
    const app = createApplication('app', { registry: registry() })
    app.createRuntime('made')
    expect(app.define(signerDef)).toEqual(success(undefined))
    expect(app.runtimes()).toEqual(['made', 'signer'])
    expect(app.definition('signer')).toEqual(signerDef)
    expect(app.runtime('signer')).toBeUndefined()
  })
  test('define rejects a duplicate id or one already opened', () => {
    const app = createApplication('app', { registry: registry() })
    app.createRuntime('made')
    app.define(signerDef)
    expect(app.define(signerDef)).toMatchObject({ ok: false, fail: { type: 'exists' } })
    expect(app.define({ ...signerDef, id: 'made' })).toMatchObject({ ok: false, fail: { type: 'exists' } })
    expect(app.define({ ...signerDef, id: 'app' })).toMatchObject({ ok: false, fail: { type: 'exists' } })
  })
  test('define keeps its own copy, and definition() gives a copy', () => {
    const app = createApplication('app', { registry: registry() })
    const def = structuredClone(signerDef)
    app.define(def)
    def.instances.pop()
    app.definition('signer')!.subscriptions.pop()
    expect(app.definition('signer')).toEqual(signerDef)
  })
  test('define rejects an instance id repeated within the definition', () => {
    const app = createApplication('app', { registry: registry() })
    const def = { ...signerDef, instances: [...signerDef.instances, { id: 'v', implementation: 'acme/keys/slow' }] }
    expect(app.define(def)).toEqual({ ok: false, fail: { type: 'exists', reason: 'instance id v is repeated' } })
    expect(app.runtimes()).toEqual([])
  })
  test('define rejects an instance id already taken in the application', async () => {
    const app = createApplication('app', { registry: registry() })
    await app.create('v', 'acme/keys/vault')
    expect(app.define(signerDef)).toEqual({ ok: false, fail: { type: 'exists', reason: 'instance id v is taken' } })
    expect(app.runtimes()).toEqual([])
  })
  test('overlapping opens both succeed', async () => {
    const app = createApplication('app', { registry: registry() })
    app.define(signerDef); app.define(clientDef)
    const [a, b] = await Promise.all([app.open('signer'), app.open('client')])
    expect(a.ok && b.ok).toBe(true)
    expect(app.runtime('client')!.members()).toEqual([T, S])
    expect(await contexts.get(T)!.one(Signer, s => s.ping('x'))).toEqual(success('signed x'))
  })
  test('overlapping opens of runtimes whose members come from each other both succeed', async () => {
    const app = createApplication('app', { registry: registry() })
    app.define({ ...signerDef, members: [{ instance: T, home: 'client' }] })
    app.define(clientDef)
    const [a, b] = await Promise.all([app.open('client'), app.open('signer')])
    expect(a.ok && b.ok).toBe(true)
    expect(app.runtime('signer')!.members()).toEqual([V, S, T])
    expect(app.runtime('client')!.members()).toEqual([T, S])
  })
  test('open never rejects: a definition that throws while built fails threw', async () => {
    const reg = registry()
    const throwing = { ...reg, implementation: (c: string) => { if (c === 'acme/keys/signer') throw new Error('registry down'); return reg.implementation(c) } }
    const app = createApplication('app', { registry: throwing })
    app.define(signerDef)
    expect(await app.open('signer')).toMatchObject({ ok: false, fail: { type: 'threw' } })
    expect(app.runtime('signer')).toBeUndefined()
  })
  test('placed members are removed when an open rolls back', async () => {
    const app = createApplication('app', { registry: registry() })
    app.define(signerDef)
    app.define({ ...clientDef, subscriptions: [clientDef.subscriptions[0]!, clientDef.subscriptions[0]!] }) // a repeated id fails on subscribe
    const p = app.open('client')
    await Promise.resolve()
    const half = app.runtime('client')!
    expect(await p).toMatchObject({ ok: false, fail: { type: 'exists' } })
    expect(half.members()).toEqual([])
    expect(app.runtime('client')).toBeUndefined()
    expect(app.runtime('signer')!.members()).toEqual([V, S])
  })
  test('opening a defined runtime opens the runtimes its members come from first', async () => {
    const app = createApplication('app', { registry: registry() })
    app.define(signerDef); app.define(clientDef)
    const r = await app.open('client')
    expect(r.ok).toBe(true)
    const client = app.runtime('client')!, signerRt = app.runtime('signer')!
    expect(r.ok && r.value).toBe(client)
    expect(signerRt.members()).toEqual([V, S])
    expect(client.members()).toEqual([T, S])
    expect(client.member(S)!.home).toBe('signer')
    expect(client.status('s1')).toBe('live')
    expect(await contexts.get(T)!.one(Signer, s => s.ping('x'))).toEqual(success('signed x'))
  })
  test('an opened runtime is returned as it is', async () => {
    const app = createApplication('app', { registry: registry() })
    app.define(signerDef)
    const [a, b] = await Promise.all([app.open('signer'), app.open('signer')])
    expect(a.ok && b.ok && a.value === b.value).toBe(true)
    const c = await app.open('signer')
    expect(c.ok && a.ok && c.value === a.value).toBe(true)
  })
  test('runtimes whose members come from each other open without looping', async () => {
    const app = createApplication('app', { registry: registry() })
    app.define({ ...signerDef, members: [{ instance: T, home: 'client' }] })
    app.define(clientDef)
    expect((await app.open('signer')).ok).toBe(true)
    expect(app.runtime('signer')!.members()).toEqual([V, S, T])
    expect(app.runtime('client')!.members()).toEqual([T, S])
  })
  test('a subscription whose end is not there yet waits', async () => {
    const app = createApplication('app', { registry: registry() })
    app.define({ ...clientDef, members: [], subscriptions: [{ id: 's1', kind: 'call', from: T, to: S }] })
    expect((await app.open('client')).ok).toBe(true)
    expect(app.runtime('client')!.status('s1')).toBe('waiting')
  })
  test('an undefined, unopened id fails not-found', async () => {
    const app = createApplication('app', { registry: registry() })
    expect(await app.open('nope')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  })
  test('a definition that cannot be built fails, and the runtime is not left half open', async () => {
    const app = createApplication('app', { registry: registry() })
    app.define({ ...clientDef, instances: [{ id: 't', implementation: 'acme/ui/nope' }] })
    expect(await app.open('client')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(app.runtime('client')).toBeUndefined()
    expect(app.runtimes()).toEqual(['client'])
    expect(app.runtime('signer')).toBeUndefined()
  })
  test('a member whose home cannot be opened is skipped with a note; its subscriptions wait and fallback uses the rest', async () => {
    const app = createApplication('app', { registry: registry() })
    const B = 'acme/keys/boom#b'
    app.define(signerDef)
    app.define({ id: 'bad', instances: [{ id: 'b', implementation: 'acme/keys/boom' }], members: [], subscriptions: [] })
    app.define({
      ...clientDef,
      members: [{ instance: B, home: 'bad' }, { instance: S, home: 'signer' }, { instance: V, home: 'nowhere' }],
      subscriptions: [{ id: 's1', kind: 'call', from: T, to: B }, { id: 's2', kind: 'call', from: T, to: S }],
    })
    const r = await app.open('client')
    expect(r.ok).toBe(true)
    const client = app.runtime('client')!
    expect(client.members()).toEqual([T, S])
    expect([client.status('s1'), client.status('s2')]).toEqual(['waiting', 'live'])
    expect(await contexts.get(T)!.fallback(Signer, s => s.ping('x'))).toEqual(success({ value: 'signed x', from: S, failures: [] }))
    expect(app.notes()).toEqual([
      `client: member ${B} skipped: ${B}: boom`,
      `client: member ${V} skipped: no runtime nowhere`,
    ])
    expect(app.runtime('bad')).toBeUndefined()
  })
})
