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
const Vault = face('acme/vault'), Signer = face('acme/signer'), Slow = face('acme/slow')

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

const registry = () => {
  const r = createRegistry()
  r.add(provider('acme/keys', [vault, signer, slow, holder]))
  r.add(provider('acme/ui', [tester, user, cached]))
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
    client.remove(S)
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
    app.define({ ...clientDef, members: [{ instance: S, home: 'nowhere' }] })
    expect(await app.open('client')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
    expect(app.runtime('client')).toBeUndefined()
    expect(app.runtimes()).toEqual(['client'])
    expect(app.runtime('signer')).toBeUndefined()
  })
})
