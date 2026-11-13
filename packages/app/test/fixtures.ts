// A page to test components on: a registry with a runtime, and calls by op.
import { Components, define, iface, Ops, Registries, Runtimes, type Component, type Op, type Snapshot } from '@pritzlaff/nano-core'
import { ApplicationOps, createApplication, type AppCatalog, type HostStores } from '../src'
import { component } from '@pritzlaff/nano-runes'
import { Type } from 'typebox'

export const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const Spy = component('test/spy', () => { const got: unknown[] = []; return { get got() { return got }, take: (x: unknown) => { got.push(x) } } }, { got: Type.Array(Type.Unknown(), { description: 'Everything taken' }), take: { in: Type.Unknown({ description: 'Anything' }), description: 'Takes a value' } })

export const page = () => {
  const rt = Runtimes.create(Registries.create('page')), reg = rt.registry
  const add = (id: string, c: Component) => { reg.add(id, Components.instantiate(c)); return id }
  const call = (id: string, op: Op, arg: unknown = null) => rt.call({ registry: 'page', instance: 'test' }, id, Ops.key(op), arg) as Promise<any>
  const value = async (id: string, op: Op) => (await call(id, op)).value
  const spy = (source: string, op: Op) => {
    const id = add(`spy-${Math.random()}`, Spy)
    reg.subscribe({ source, op: Ops.key(op), listener: id, target: Ops.key(Spy.ops.take) })
    return (reg.get(id)!.value as { got: unknown[] }).got
  }
  return { rt, reg, add, call, value, spy }
}

// An application whose kinds implement and need interfaces: db implements t/db, service needs one (db), form needs a t/bff nothing implements.
const Db = iface('t/db', { save: { in: Type.String(), out: Type.String() } })
const Bff = iface('t/bff', { ask: { in: Type.String(), out: Type.String() } })
const Api = iface('t/api', { put: { in: Type.String(), out: Type.String() } })
export const needsCatalog: AppCatalog = {
  db: { component: define('t/memory-db', Db, {}, () => ({ save: x => `saved ${x}` })) },
  service: { component: define('t/service', Api, { db: Db }, ({ db }) => ({ put: x => db.save(x) })) },
  form: { component: define('t/form', Api, { bff: Bff }, ({ bff }) => ({ put: x => bff.ask(x) })) },
}
export const needsApp = () => {
  const { host, catalog } = createApplication({ catalogs: [needsCatalog] })
  const call = async (op: Op, arg: unknown = null) => { const r = await host.call({ registry: 'host', instance: 'test' }, 'application', Ops.key(op), arg) as any; if ('error' in r) throw new Error(r.error); return r.value }
  const st = { imports: [] as any[], theme: { theme: 'enterprise', mode: 'system' as 'system' | 'light' | 'dark' }, title: 'Nano' }
  const stores: HostStores = { imports: { list: () => st.imports, set: xs => { st.imports = xs } }, theme: { get: () => st.theme, set: c => { st.theme = c } }, title: { get: () => st.title, set: t => { st.title = t } } }
  const deps = { host, stores, catalog, known: { theme: () => true, icon: () => true }, importPackage: async () => ({}) }
  const bindings = async () => ((await call(ApplicationOps.systems)) as Snapshot[]).flatMap(s => s.bindings)
  const make = (kind: string, name: string, system = 'host') => call(ApplicationOps.createComponent, { kind, name, system })
  return { host, call, stores, deps, bindings, make }
}
