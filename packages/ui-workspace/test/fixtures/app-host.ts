// A host for the snapshot/apply tests: a runtime with the platform over a catalog (bundle, shell's profile, and a
// sandboxed-only kind), a built-in profile and example, and in-memory stores.
import { Components, Ops, Registries, Runtimes } from '@pritzlaff/nano-core'
import { Type } from 'typebox'
import { component } from '@pritzlaff/nano-runes'
import { catalog as bundle } from '@composable/bundle'
import { catalog as shell, Profile } from '@composable/shell'
import { platform } from '@composable/platform'
import { deploy, type AppCatalog, type Mode } from '../../src/sandbox/deploy'
import type { Stores } from '../../src/app/snapshot'

export const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

export function appHost() {
  const catalog: AppCatalog = Object.fromEntries(Object.entries({ ...bundle, ...shell }).map(([k, e]) => [k, { ...e, modes: ['host'] as Mode[], trust: 'trusted' as const, ...(k === 'map' || k === 'filter' ? { code: ['setCode', 'configure'] } : {}) }]))
  catalog.boxed = { component: component('t.test/boxed', () => ({ configure: (_: unknown) => {} }), { configure: { in: Type.Unknown(), description: 'Takes anything' } }), title: 'Boxed', modes: ['isolated-sandbox'], trust: 'sandboxed', source: { url: 'https://x.test/p.js' } }
  const host = Runtimes.create(Registries.create('host'))
  const deployed: { id: string; mode: string }[] = []
  const open = (() => ({ port: new MessageChannel().port1, ready: new Promise<void>(() => {}), dispose() {} })) as never
  host.registry.add('platform', Components.instantiate(platform(host, catalog, {
    deploy: (system, id, kind, mode, owner, outward) => { deployed.push({ id, mode: mode ?? 'host' }); return deploy(system, id, kind, (mode ?? 'host') as Mode, { catalog, owner, open, ...(outward && { outward }) }) },
  })), { kind: 'app', name: 'test' })
  const me = { registry: 'host', instance: 'test' }
  const call = (id: string, op: any, arg: unknown = null) => host.call(me, id, Ops.key(op), arg) as Promise<any>
  return { host, catalog, deployed, call }
}

export function memoryStores(init: Partial<{ title: string; theme: { theme: string; mode: string }; layouts: Record<string, unknown> }> = {}) {
  const st = { imports: [] as any[], workspaces: [] as any[], layouts: new Map(Object.entries(init.layouts ?? {})), theme: (init.theme ?? { theme: 'enterprise', mode: 'system' }) as any, title: init.title ?? 'Nano' }
  const stores: Stores = {
    imports: { list: () => st.imports, set: xs => { st.imports = xs } },
    workspaces: { list: () => st.workspaces, set: xs => { st.workspaces = xs } },
    layouts: { get: p => st.layouts.get(p), set: (p, l) => { st.layouts.set(p, l) } },
    theme: { get: () => st.theme, set: c => { st.theme = c } },
    title: { get: () => st.title, set: t => { st.title = t } },
  }
  return { st, stores }
}

export { Profile }
