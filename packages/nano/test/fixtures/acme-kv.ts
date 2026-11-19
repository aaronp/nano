/** Shared fixtures of the contract-surface tests: a KV and a notes implementation, and an Application opened over them. */
import { Type } from 'typebox'
import { AppDeployment, Application, Implementation, Interface, Op, Provider, Registry, Schema, type NanoResult } from '../../src/index.ts'

export const Str = Schema.define(Type.String(), 'Str')
export const KV = Interface.define('acme.KV', {
  get: Op.action(Str, Type.Union([Type.String(), Type.Null()])),
  put: Op.action(Type.Object({ k: Type.String(), v: Type.String() }), Type.Null()),
  size: Op.action(Type.Null(), Type.Integer()),
  changed: Op.event(Str),
})
export type KV = Interface.Type<typeof KV>
export const Notes = Interface.define('acme.Notes', { note: Op.action(Str, Type.Integer()) })
export type Notes = Interface.Type<typeof Notes>

export const must = <T>(r: NanoResult<T>): T => { if (!r.ok) throw new Error(r.fail.reason); return r.value }

export const heard: string[] = []
export const memory = (tag: string) => Implementation.define(`acme/${tag}`, {
  provides: [KV],
  make: ctx => {
    const m = new Map<string, string>()
    return {
      async get(k) { return m.get(k) ?? null },
      async put({ k, v }) { m.set(k, v); await ctx.publish(KV.ops.changed, k) },
      async size() { if (tag === 'broken') throw new Error('disk on fire'); return m.size },
    } satisfies Omit<KV, 'changed'>   // an event published through ctx needs no source method
  },
})
export const notes = Implementation.define('acme/notes', {
  provides: [Notes],
  dependencies: { store: KV },
  make: ({ deps, one }) => {
    const s = one(KV)
    if (s.ok) s.value.on(KV.ops.changed, ({ output: k }) => { heard.push(k satisfies string) })
    let n = 0
    return { async note(text) { await deps.store.put({ k: String(++n), v: text }); return deps.store.size() } } satisfies Notes
  },
})
export const mem = memory('mem')
export const other = memory('other')
export const broken = memory('broken')
export const registry = Registry.create()
must(registry.add(Provider.define('acme', [mem, other, broken, notes])))
export const deployment = (store: string): AppDeployment => ({
  pods: { store: { implementation: store, eager: false }, notes: { implementation: 'acme/notes', eager: false } },
  runtimes: { main: { pods: ['store', 'notes'], subscriptions: [{ kind: 'call', from: 'notes', to: 'store' }] } },
})
export const open = async (store = 'acme/mem') => must(await Application.create(must(AppDeployment.assemble(deployment(store), registry))))
export const thrownBy = (f: () => unknown) => { try { f() } catch (e) { return e as Error & { fail: { type: string } } } }
