/** A `sent` event carries its message's input: call, pipe and `on`; subscribe and unsubscribe carry none. */
import { describe, expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Application, AppDeployment, Implementation, Interface, Op, Pod, Provider, Registry, Schema, provide, success, type AppEvent, type NanoResult } from '../src/index.ts'

const Str = Schema.define(Type.String(), 'Str')
const Store = Interface.define('acme.Store', { save: Op.action(Str, Str), saved: Op.event(Str) })
const Log = Interface.define('acme.Log', { record: Op.action(Str, Str) })
const store = Implementation.define('acme/store', { provides: [Store], make: ctx => [provide(Store, { save: async s => { await ctx.publish(Store.ops.saved, s); return success(s) } })] })
const logger = Implementation.define('acme/log', { provides: [Log], make: () => [provide(Log, { record: async s => success(s) })] })
const watcher = Implementation.define('acme/watcher', { provides: [Log], dependencies: { store: Store }, make: ctx => {
  const st = ctx.one(Store)
  if (st.ok) st.value.on(Store.ops.saved, () => {})
  return [provide(Log, { record: async s => success(s) })]
} })

const ok = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
type Sent = Extract<AppEvent, { type: 'sent' }>
const run = async (d: AppDeployment) => {
  const reg = Registry.create(); reg.add(Provider.define('acme', [store, logger, watcher]))
  const app = ok(await Application.create(ok(AppDeployment.assemble(d, reg)), {}))
  const events: AppEvent[] = []
  app.listen(e => events.push(e))
  const kind = (k: Sent['kind']) => events.filter((e): e is Sent => e.type === 'sent' && e.kind === k)
  return { app, kind }
}
const tick = () => new Promise(r => setTimeout(r, 0))

describe('sent carries its input', () => {
  test("a host call's sent carries its input", async () => {
    const { app, kind } = await run({ pods: { db: Pod.lazy(store) }, runtimes: { r: { pods: ['db'], subscriptions: [] } } })
    await app.call('r', 'db').save('x')
    expect(kind('call').map(e => e.input)).toEqual(['x'])
  })
  test("a pipe's sent carries the piped value", async () => {
    const { app, kind } = await run({ pods: { db: Pod.lazy(store), log: Pod.lazy(logger) },
      runtimes: { r: { pods: ['db', 'log'], subscriptions: [{ kind: 'pipe', from: 'db', source: 'acme.Store/save', to: 'log', target: 'acme.Log/record' }] } } })
    await app.call('r', 'db').save('x')
    await tick()
    expect(kind('pipe').map(e => e.input)).toEqual(['x'])
  })
  test("an on's sent carries the published value; a subscribe's sent carries no input", async () => {
    const { app, kind } = await run({ pods: { w: Pod.eager(watcher), db: Pod.lazy(store) },
      runtimes: { r: { pods: ['w', 'db'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } } })
    app.runtime('r').subscribe(Store.ops.saved, () => {})
    await app.call('r', 'db').save('x')
    await tick()
    expect(kind('on').filter(e => e.to === 'w').map(e => e.input)).toEqual(['x'])
    expect(kind('subscribe').length).toBeGreaterThan(0)
    for (const e of kind('subscribe')) expect('input' in e).toBe(false)
  })
})
