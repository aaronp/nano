import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { AppDeployment, Application, Implementation, Interface, Op, Policies, Provider, Registry, type Ask, type NanoContext } from '../src/index.ts'

test('allowAll approves anything', () => {
  expect(Policies.allowAll().isAllowed({ runtime: 'r', kind: 'call', from: 'a#1', to: 'b#1', outside: false, data: { x: 1 } })).toEqual({ approved: true })
})

test('isAllowed is asked with the envelope', async () => {
  const Db = Interface.define('acme.Db', { save: Op.action(Type.String(), Type.Null()) })
  let ctx: NanoContext | undefined
  const registry = Registry.create()
  registry.add(Provider.define('acme', [
    Implementation.define('acme/db', { provides: [Db], make: c => { ctx = c as NanoContext; return { async save() {} } } }),
    Implementation.define('acme/watch', { provides: [Db], dependencies: { store: Db }, make: c => { const s = c.one(Db); if (s.ok) s.value.on(Db.ops.save, () => {}); return { async save() {} } } }),
    Implementation.define('acme/plain', { provides: [Db], make: () => ({ async save() {} }) }),
  ]))
  const asks: Ask[] = []
  const policies = { r: { isAllowed: (ask: Ask) => (asks.push(ask), { approved: true as const }) } }
  const base = (pods: string[]): AppDeployment => ({
    pods: { db: { implementation: 'acme/db', eager: true }, x: { implementation: 'acme/plain', eager: false }, w: { implementation: 'acme/watch', eager: true } },
    runtimes: { r: { pods: [...pods, 'w'], subscriptions: [{ kind: 'call', from: 'w', to: 'db' }] } },
  })
  const d = AppDeployment.assemble(base(['db']), registry)
  if (!d.ok) throw new Error(d.fail.reason)
  const app = await Application.create(d.value, { policies })
  if (!app.ok) throw new Error(app.fail.reason)
  expect(asks.find(a => a.kind === 'subscribe')).toEqual({ runtime: 'r', kind: 'subscribe', from: 'w', to: 'db', port: 'acme.Db/save', outside: false })
  await app.value.call('db').save('x')
  expect(asks.find(a => a.kind === 'call')).toEqual({ runtime: 'r', kind: 'call', from: 'host', to: 'db', port: 'acme.Db/save', outside: true, data: 'x' })
  ctx!.addOnPodChangeListener(() => {})
  await app.value.apply(base(['db', 'x']))
  expect(asks.at(-1)).toMatchObject({ runtime: 'r', kind: 'lifecycle', from: 'db', to: 'x', outside: false })
})
