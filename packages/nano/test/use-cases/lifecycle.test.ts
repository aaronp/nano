/** Use case 3 (spec: 2026-11-16-runtime-view-streams-design.md): `ctx.addOnPodChangeListener` hears pods added to or removed from its runtimes. */
import { expect, test } from 'bun:test'
import { Type } from 'typebox'
import { AppDeployment, Application, Implementation, Interface, Op, Policies, Provider, Registry, type AppEvent, type Ask, type NanoContext, type NanoResult } from '../../src/index.ts'

const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }
const Ping = Interface.define('acme.Ping', { ping: Op.action(Type.Null(), Type.Null()) })
type Change = Parameters<Parameters<NanoContext['addOnPodChangeListener']>[0]>[0]
const log: Change[] = []
let ctxs: Record<string, NanoContext> = {}
const registry = Registry.create()
must(registry.add(Provider.define('acme', [
  Implementation.define('acme/watcher', { provides: [Ping], make: ctx => { ctxs[ctx.self] = ctx as NanoContext; return { async ping() {} } } }),
  Implementation.define('acme/plain', { provides: [Ping], make: () => ({ async ping() {} }) }),
])))
const pod = (implementation: string) => ({ implementation, eager: true })
const base = (): AppDeployment => ({
  pods: { w: pod('acme/watcher'), x: pod('acme/plain') },
  runtimes: { r: { pods: ['w'], subscriptions: [] }, other: { pods: ['x'], subscriptions: [] } },
})
const open = async (policies = {}) => {
  log.length = 0; ctxs = {}
  const app = must(await Application.create(must(AppDeployment.assemble(base(), registry)), { policies }))
  ctxs.w!.addOnPodChangeListener(e => { log.push(e) })
  return app
}
const withPods = (pods: string[], other: string[]): AppDeployment => {
  const d = base()
  for (const p of [...pods, ...other]) d.pods[p] = pod('acme/plain')
  d.runtimes.r!.pods.push(...pods); d.runtimes.other!.pods.push(...other)
  return d
}

test('a pod hears another added to and removed from its runtime', async () => {
  const app = await open()
  must(await app.apply(withPods(['y'], [])))
  expect(log).toEqual([{ type: 'added', runtime: 'r', pod: 'y', implementation: 'acme/plain' }])
  must(await app.apply(base()))
  expect(log[1]).toEqual({ type: 'removed', runtime: 'r', pod: 'y', implementation: 'acme/plain' })
})

test("it hears nothing about pods already there when it registered, nor about other runtimes", async () => {
  const app = await open()
  must(await app.apply(withPods([], ['z'])))
  expect(log).toEqual([])
})

test('a policy denying lifecycle stops it', async () => {
  const app = await open({ r: { isAllowed: (ask: Ask) => ask.kind === 'lifecycle' ? { approved: false, reason: 'no' } : { approved: true } } })
  const ev: AppEvent[] = []; app.listen(e => ev.push(e))
  must(await app.apply(withPods(['y'], [])))
  expect(log).toEqual([])
  expect(ev.some(e => e.type === 'denied')).toBe(true)
})

test('the listener ends when its build closes', async () => {
  const app = await open()
  must(await app.restart('w'))
  must(await app.apply(withPods(['y'], [])))
  expect(log).toEqual([])
})

test('a pod-change listener may itself restart without hanging', async () => {
  const app = await open()
  ctxs.w!.addOnPodChangeListener(async () => { await app.restart('w') })
  must(await app.apply(withPods(['y'], [])))
})
