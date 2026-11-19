/** `ops` on a call edge: op pairs `<interface>/<op>`, checked like a pipe's ports; an ops-only change rewires. */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { Application, AppDeployment, Implementation, Interface, Op, Pod, Provider, Registry, provide, success } from '../src/index.ts'

const Front = Interface.define('acme.Front', { send: Op.action(Type.String(), Type.Null()) })
const Store = Interface.define('acme.Store', { save: Op.action(Type.String(), Type.Null()) })
const front = Implementation.define('acme/front', { provides: [Front], dependencies: { store: Store }, make: () => [provide(Front, { send: async () => success(null) })] })
const store = Implementation.define('acme/store', { provides: [Store], make: () => [provide(Store, { save: async () => success(null) })] })
const reg = () => { const r = Registry.create(); r.add(Provider.define('acme', [front, store])); return r }
const dep = (ops?: unknown) => ({
  pods: { f: Pod.lazy(front), s: Pod.lazy(store) },
  runtimes: { r: { pods: ['f', 's'], subscriptions: [{ kind: 'call', from: 'f', to: 's', ...(ops ? { ops } : {}) }] } },
})
const pair = { source: 'acme.Front/send', target: 'acme.Store/save' }

test('an edge with ops creates; old edges without ops still do', () => {
  expect(AppDeployment.assemble(dep([pair]), reg()).ok).toBe(true)
  expect(AppDeployment.assemble(dep(), reg()).ok).toBe(true)
})
test('a target or source the pod lacks is invalid-input naming the port', () => {
  const t = AppDeployment.assemble(dep([{ ...pair, target: 'acme.Store/nope' }]), reg())
  expect(t).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  expect(JSON.stringify(t)).toContain('acme.Store/nope')
  const s = AppDeployment.assemble(dep([{ ...pair, source: 'acme.Front/nope' }]), reg())
  expect(s).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  expect(JSON.stringify(s)).toContain('acme.Front/nope')
})
test('duplicate pairs and non-string ports are invalid-input', () => {
  expect(AppDeployment.assemble(dep([pair, pair]), reg())).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
  expect(AppDeployment.assemble(dep([{ source: 1 }]), reg())).toMatchObject({ ok: false, fail: { type: 'invalid-input' } })
})
test('an apply that only changes ops rewires and restarts nothing', async () => {
  const r = AppDeployment.assemble(dep(), reg())
  if (!r.ok) throw new Error(r.fail.reason)
  const app = await Application.create(r.value)
  if (!app.ok) throw new Error(app.fail.reason)
  const events: any[] = []
  app.value.listen(e => events.push(e))
  expect((await app.value.apply(dep([pair]) as never)).ok).toBe(true)
  expect(events.filter(e => e.type === 'applied')).toEqual([{ type: 'applied', caller: 'host', added: [], removed: [], changed: [], rewired: ['r'] }])
})
