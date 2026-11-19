/** The contract surface (spec: docs/superpowers/specs/2026-11-16-contract-surface-design.md); fixtures in fixtures/acme-kv.ts. */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { AppDeployment, Application, Implementation, Interface, Op, Provider, Registry, Schema, type NanoResult } from '../src/index.ts'
import { Str, KV, Notes, must, heard, notes, mem, other, broken, registry, deployment, open, thrownBy } from './fixtures/acme-kv.ts'

test('Interface.Type is the plain interface: null input is no argument, null output is void, events are source methods', () => {
  const t = {} as KV
  void (() => { t.size() satisfies Promise<number>; t.put({ k: 'a', v: 'b' }) satisfies Promise<void>; t.get('a') satisfies Promise<string | null> })
  void (() => t.changed() satisfies AsyncIterable<string>)
})

test('a bare schema is defined unlabelled, hashing as the same labelled schema', () => {
  expect(KV.ops.put.input!.label).toBeUndefined()
  expect(KV.ops.get.input).toBe(Str)
  const a = Interface.define('acme.A', { n: Op.action(Type.Null(), Type.Integer()) })
  const b = Interface.define('acme.A', { n: Op.action(Schema.define(Type.Null(), 'Nothing'), Schema.define(Type.Integer(), 'N')) })
  expect(a.ops.n.coord).toBe(b.ops.n.coord)
})

test('app.get gives the plain object; ctx.deps reaches the store through the runtime; make may return a plain object', async () => {
  heard.length = 0
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

test('app.get is not-found or not-unique as a thrown Fail, narrowed by runtime or pod, and follows apply', async () => {
  const app = await open()
  const none = thrownBy(() => app.get(Interface.define('acme.None', { x: Op.action(Str, Str) })))
  expect(none).toBeInstanceOf(Error)
  expect(none?.fail.type).toBe('not-found')
  const two = deployment('acme/mem')
  two.pods.spare = { implementation: 'acme/other', eager: false }
  two.runtimes.main!.pods.push('spare')
  must(await app.apply(two))
  expect(thrownBy(() => app.get(KV))?.fail.type).toBe('not-unique')
  await app.get(KV, { pod: 'spare' }).put({ k: 'a', v: 'b' })
  expect(await app.runtime('main').get(KV, { pod: 'spare' }).size()).toBe(1)
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

test('app.get with several runtimes is not-unique ("name a runtime"); app.runtime(id) sees only what is placed there', async () => {
  const d = deployment('acme/mem')
  d.runtimes.side = { pods: ['store'], subscriptions: [] }
  const app = must(await Application.create(must(AppDeployment.assemble(d, registry))))
  expect(app.resolve(KV)).toMatchObject({ ok: false, reason: 'not-unique', fail: { type: 'not-unique' } })
  expect(thrownBy(() => app.get(KV))?.fail.type).toBe('not-unique')
  expect(await app.call('store').size(null)).toMatchObject({ ok: false, fail: { type: 'not-unique' } })
  expect(await app.runtime('side').get(KV).size()).toBe(0)
  expect(app.runtime('side').resolve(Notes)).toMatchObject({ ok: false, reason: 'not-found' })
  expect(await app.runtime('side').call('notes').note('x')).toMatchObject({ ok: false, fail: { type: 'not-found' } })
  expect(await app.runtime('main').call('notes').note('x')).toMatchObject({ ok: true, value: 1 })
})
