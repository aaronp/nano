// Shared setup of the cross-origin tests: registers happy-dom (page http://host.test), a foreign app and its fakes.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { Type } from 'typebox'
import { Coord, Application, AppDeployment, Registry, Schema, Interface, Implementation, Op, provide, success, type Pod } from '@pritzlaff/nano-core'
import { importApp, foreignOrigin, type Foreign, type Loaded } from '../src/import.ts'
import { isolated, remembered } from '../src/import-gate.ts'
import { described, probe } from '../src/described.ts'
import { describeProvider } from '../src/sandbox/protocol.ts'

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: 'http://host.test/' })

export const ns = Coord.namespace('other.fx')

export const Text = Schema.define(Type.String(), 'Text')
export const X = Interface.define('other.X', { x: Op.action(Text, Text) })
export const real = Implementation.define(ns.implementationId('x'), { provides: [X], make: () => [provide(X, { x: async s => success(`real ${s}`) })] })
export const realProvider = ns.provider([real])

export const app: AppDeployment = {
  pods: {
    h: { implementation: 'other.fx/x', eager: false },
    s: { implementation: 'other.fx/x', eager: false, isolation: 'sandbox' },
    i: { implementation: 'other.fx/x', eager: false, isolation: 'isolated-sandbox' },
  },
  runtimes: { main: { pods: ['h', 's', 'i'], subscriptions: [] } },
  modules: { 'other.fx': './x.js' },
}
export const docs: Record<string, AppDeployment> = {
  'https://other.test/app/nano.json': app,
  'https://other.test/iso/nano.json': { pods: { i: { implementation: 'other.fx/x', eager: false, isolation: 'isolated-sandbox' } },
    runtimes: { main: { pods: ['i'], subscriptions: [] } }, modules: { 'other.fx': '../app/x.js' } },
  'http://host.test/app/nano.json': { pods: { h: { implementation: 'other.fx/x', eager: false } }, runtimes: {}, modules: { 'other.fx': './x.js' } },
}
export const domFetch = globalThis.fetch
export const installFetch = () => { globalThis.fetch = (async (u: string) => ({ ok: true, status: 200, json: async () => structuredClone(docs[u]) })) as never }
export const restoreFetch = () => { globalThis.fetch = domFetch }

export const empty = (): Loaded => ({ deployment: { pods: {}, runtimes: {} }, registry: Registry.create(), views: {} })
export function fakes(o: { confirm?: boolean; approve?: boolean; remember?: boolean } = {}) {
  const seen = { load: [] as string[], probe: [] as string[], confirm: [] as Foreign[][], approve: [] as string[] }
  const deps = {
    load: async (u: string) => { seen.load.push(u); return { default: realProvider } },
    probe: async (u: string) => { seen.probe.push(u); return described(describeProvider(realProvider, { 'other.fx/x': 'x-view' })) },
    confirm: async (list: Foreign[]) => { seen.confirm.push(list); return o.confirm ?? true },
    approve: async (t: string) => { seen.approve.push(t); await Promise.resolve(); return o.approve ?? true },
  }
  if (o.remember) deps.approve = remembered(deps.approve)
  return { seen, deps }
}
/** The imported app running, its non-host pods through `isolated` around a stand-in that runs the probed shape in place. */
export async function running(o: { approve: boolean; remember?: boolean }) {
  const { seen, deps } = fakes(o)
  const r = await importApp('https://other.test/app/nano.json', empty(), deps)
  if (!r.ok) throw new Error(r.fail.reason)
  const runtimes = AppDeployment.assemble(r.value.deployment, r.value.registry)
  if (!runtimes.ok) throw new Error(runtimes.fail.reason)
  const standIn: Implementation = { ...real, make: real.make }
  const isolate = (_: string, pod: Pod) => isolated(standIn, pod.isolation, foreignOrigin(r.value.deployment.modules!['other.fx']), deps.approve)
  const made = await Application.create(runtimes.value, { isolate })
  if (!made.ok) throw new Error(made.fail.reason)
  return { seen, app: made.value, call: (pod: string) => (made.value.call('main', pod) as unknown as { x(s: string): Promise<unknown> }).x('hi') }
}
