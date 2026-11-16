/**
 * The contract surface (spec: docs/superpowers/specs/2026-11-16-contract-surface-design.md): `Interface.Type`, bare
 * schemas in ops, `ctx.deps`, a plain `make`, `one` as a result, typed `on`/`publish`, and `app.get`.
 */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { AppDeployment, Application, Implementation, Interface, Op, Provider, Registry, Schema, Selector, type NanoContext, type NanoResult } from '../src/index.ts'

const Str = Schema.define(Type.String(), 'Str')
const KV = Interface.define('acme.KV', {
  get: Op.action(Str, Type.Union([Type.String(), Type.Null()])),
  put: Op.action(Type.Object({ k: Type.String(), v: Type.String() }), Type.Null()),
  size: Op.action(Type.Null(), Type.Integer()),
  changed: Op.event(Str),
})
type KV = Interface.Type<typeof KV>
const Notes = Interface.define('acme.Notes', { note: Op.action(Str, Type.Integer()) })
type Notes = Interface.Type<typeof Notes>

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

let heard: string[] = []
const memory = (tag: string) => Implementation.define(`acme/${tag}`, {
  provides: [KV],
  make: ctx => {
    const m = new Map<string, string>()
    return {
      async get(k) { return m.get(k) ?? null },
      async put({ k, v }) { m.set(k, v); await ctx.publish(KV.ops.changed, k) },
      async size() { if (tag === 'broken') throw new Error('disk on fire'); return m.size },
    } satisfies KV
  },
})
const notes = Implementation.define('acme/notes', {
  provides: [Notes],
  dependencies: { store: KV },
  make: ({ deps, one }) => {
    const s = one(KV)
    if (s.ok) s.value.on(KV.ops.changed, k => { heard.push(k satisfies string) })
    let n = 0
    return { async note(text) { await deps.store.put({ k: String(++n), v: text }); return deps.store.size() } } satisfies Notes
  },
})
const [mem, other, broken] = [memory('mem'), memory('other'), memory('broken')]
const registry = Registry.create()
must(registry.add(Provider.define('acme', [mem, other, broken, notes])))
const deployment = (store: string): AppDeployment => ({
  pods: { store: { implementation: store, eager: false }, notes: { implementation: 'acme/notes', eager: false } },
  runtimes: { main: { pods: ['store', 'notes'], subscriptions: [{ kind: 'call', from: 'notes', to: 'store' }] } },
})
const open = async (store = 'acme/mem') => must(await Application.create(must(AppDeployment.assemble(deployment(store), registry))))

test('Interface.Type is the plain interface: null input is no argument, null output is void, events are not methods', () => {
  const t = {} as KV
  void (() => { t.size() satisfies Promise<number>; t.put({ k: 'a', v: 'b' }) satisfies Promise<void>; t.get('a') satisfies Promise<string | null> })
  // @ts-expect-error events are not methods
  void (() => t.changed)
})

test('a bare schema is defined unlabelled, hashing as the same labelled schema', () => {
  expect(KV.ops.put.input!.label).toBeUndefined()
  expect(KV.ops.get.input).toBe(Str)
  const a = Interface.define('acme.A', { n: Op.action(Type.Null(), Type.Integer()) })
  const b = Interface.define('acme.A', { n: Op.action(Schema.define(Type.Null(), 'Nothing'), Schema.define(Type.Integer(), 'N')) })
  expect(a.ops.n.coord).toBe(b.ops.n.coord)
})

test('app.get gives the plain object; ctx.deps reaches the store through the runtime; make may return a plain object', async () => {
  heard = []
  const app = await open()
  const sent: string[] = []
  app.listen(e => { if (e.type === 'sent') sent.push(`${e.from}->${e.to}`) })
  const n = app.get(Notes)
  expect(await n.note('milk')).toBe(1)
  expect(await app.get(KV).get('1')).toBe('milk')
  expect(sent).toContain('notes->store')
  await Bun.sleep(0)
  expect(heard).toEqual(['1'])
})

test('a Fail through deps or app.get throws an Error carrying it; a plain throw is threw', async () => {
  const app = await open('acme/broken')
  const e = await app.get(Notes).note('x').catch(x => x)
  expect(e).toBeInstanceOf(Error)
  expect(e.fail.type).toBe('threw')
  const bad = await app.get(Notes).note(1 as unknown as string).catch(x => x)
  expect(bad.fail.type).toBe('invalid-input')
})

const thrownBy = (f: () => unknown) => { try { f() } catch (e) { return e as Error & { fail: { type: string } } } }

test('app.get is not-found or ambiguous as a thrown Fail, narrowed by runtime or pod, and follows apply', async () => {
  const app = await open()
  const none = thrownBy(() => app.get(Interface.define('acme.None', { x: Op.action(Str, Str) })))
  expect(none).toBeInstanceOf(Error)
  expect(none?.fail.type).toBe('not-found')
  const two = deployment('acme/mem')
  two.pods.spare = { implementation: 'acme/other', eager: false }
  two.runtimes.main!.pods.push('spare')
  must(await app.apply(two))
  expect(thrownBy(() => app.get(KV))?.fail.type).toBe('ambiguous')
  await app.get(KV, { pod: 'spare' }).put({ k: 'a', v: 'b' })
  expect(await app.get(KV, { pod: 'spare', runtime: 'main' }).size()).toBe(1)
  expect(await app.get(KV, { pod: 'store' }).size()).toBe(0)
})

test('ctx.one is a result: not-found is a Fail to look at, and a Selection always has pod, runtime, call and on', async () => {
  let got: NanoResult<unknown> | undefined
  const looker = Implementation.define('acme/looker', { provides: [Notes], make: ctx => {
    got = ctx.one(Notes)
    const s = ctx.one(KV)
    if (s.ok) { s.value.pod satisfies string; s.value.runtime satisfies string }
    // @ts-expect-error on takes only ops of the selected interface
    if (s.ok) s.value.on(Notes.ops.note, () => {})
    // @ts-expect-error publish's data is typed by the op
    void ctx.publish(KV.ops.changed, 1)
    return { async note() { return 0 } }
  } })
  const r = Registry.create()
  must(r.add(Provider.define('acme', [mem, looker])))
  const d: AppDeployment = { pods: { store: { implementation: 'acme/mem', eager: false }, l: { implementation: 'acme/looker', eager: true } },
    runtimes: { main: { pods: ['store', 'l'], subscriptions: [] } } }
  must(await Application.create(must(AppDeployment.assemble(d, r))))
  expect(got).toMatchObject({ ok: false, fail: { type: 'not-found' } })
})

test('app.get: a pod placed in two runtimes is ambiguous unless where.runtime names one (policies are per runtime)', async () => {
  const d = deployment('acme/mem')
  d.runtimes.side = { pods: ['store'], subscriptions: [] }
  const app = must(await Application.create(must(AppDeployment.assemble(d, registry))))
  expect(thrownBy(() => app.get(KV))?.fail.type).toBe('ambiguous')
  expect(await app.get(KV, { runtime: 'side' }).size()).toBe(0)
})

test('app.resolve says what it found (pod, runtime, implementation) or why not; app.get is its getOrThrow', async () => {
  const app = await open()
  const r = app.resolve(KV)
  expect(r).toMatchObject({ ok: true, pod: 'store', runtime: 'main', implementation: 'acme/mem' })
  await r.getOrThrow().put({ k: 'a', v: 'b' })
  expect(await r.value!.size()).toBe(1)
  expect(await app.get(KV).size()).toBe(1)
  const none = app.resolve(KV, { pod: 'notes' })
  expect(none).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  expect(none.pod).toBeUndefined()
  expect(thrownBy(() => none.getOrThrow())?.fail).toEqual(none.fail!)
})

test('the plain proxy: an unknown method throws an Error carrying unknown-op, not a TypeError', async () => {
  const app = await open()
  const e = await (app.get(KV) as unknown as Record<string, () => Promise<never>>).nope!().catch((x: Error & { fail: { type: string } }) => x)
  expect(e).toBeInstanceOf(Error)
  expect(e.fail.type).toBe('unknown-op')
})

test('a deps role narrowed by Selector.of keeps its interface type', () => {
  type Ctx = NanoContext<{ store: ReturnType<typeof Selector.of<typeof KV>> }>
  const deps = {} as Ctx['deps']
  void (() => deps.store.size() satisfies Promise<number>)
})
