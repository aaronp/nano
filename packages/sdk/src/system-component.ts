/**
 * The System component: a System exposed through ops, so anything that can call and subscribe can see what is in
 * it, create and remove instances (from a catalog), connect them, and bind dependencies. It can be registered in
 * its own System, or in another (a System of Systems). Policies, pickers and editors are just components using it.
 */
import Type from 'typebox'
import { Components } from './components'
import type { SystemRuntime } from './system'
import { ComponentId, Instance, Manifest, fail, ok, type Component, type ComponentFactory, type Op } from './types'

const S = Components.declare({ author: 'composable', id: 'system' })
const Link = Type.Object({ from: Type.String(), output: Type.String(), to: Type.String(), op: Type.String() },
  { $id: 'composable.Link', description: 'A live connection: from\'s output (a notification or an action\'s outcome) feeds to\'s op.' })
const Binding = Type.Object({ from: Type.String(), dependency: Type.String(), to: Type.String(), op: Type.String() },
  { $id: 'composable.Binding', description: 'from\'s dependency is served by to\'s op.' })
const Instances = Type.Array(Instance)

export const SystemOps = {
  instances: S.op('instances', 'The instances in this System, with their manifests', { input: Type.Null(), output: Instances }),
  changed: S.op('changed', 'Published whenever an instance is added or removed', { output: Instances }),
  definitions: S.op('definitions', 'The components this System can create', { input: Type.Null(), output: Type.Array(Manifest) }),
  create: S.op('create', 'Create and register an instance of a catalog component', {
    input: Type.Object({ component: ComponentId, name: Type.String() }), output: Type.Object({ name: Type.String() }),
  }),
  remove: S.op('remove', 'Unregister an instance (disposing it if this System created it)', { input: Type.Object({ name: Type.String() }) }),
  connect: S.op('connect', 'Feed one instance\'s output into another\'s op', { input: Link }),
  disconnect: S.op('disconnect', 'Remove a link made with connect', { input: Link }),
  links: S.op('links', 'The links in place', { input: Type.Null(), output: Type.Array(Link) }),
  linksChanged: S.op('links-changed', 'Published whenever a link is made or removed', { output: Type.Array(Link) }),
  bind: S.op('bind', 'Serve one instance\'s dependency with another\'s op', { input: Binding }),
  unbind: S.op('unbind', 'Remove a binding', { input: Type.Object({ from: Type.String(), dependency: Type.String() }) }),
  bindings: S.op('bindings', 'The bindings in place', { input: Type.Null(), output: Type.Array(Binding) }),
}

const key = (l: { from: string; output: string; to: string; op: string }) => [l.from, l.output, l.to, l.op].join('\u0000')
const same = (a: ComponentId, b: ComponentId) => a.author === b.author && a.id === b.id

/** A System component over `runtime`. `catalog`: the components its `create` op can make. */
export function systemComponent(runtime: SystemRuntime, opts: { catalog?: readonly ComponentFactory<any>[] } = {}): ComponentFactory {
  const catalog = opts.catalog ?? [], o = SystemOps
  const opOf = (inst: string, op: string) => runtime.snapshot().instances.find(i => i.id === inst)?.manifest.ops.find(x => x.name === op)
  const factory = S.define({
    state: () => ({ links: new Map<string, () => void>(), unbinds: new Map<string, () => void>(), made: new Map<string, Component>() }),
    handlers: [
      [o.instances, () => ok(runtime.snapshot().instances)],
      [o.definitions, () => ok(catalog.map(f => f.manifest))],
      [o.create, async ({ component, name }, { state }) => {
        const f = catalog.find(x => same(x.manifest.id, component))
        if (!f) return fail('unknown-target', `${component.author}/${component.id} is not in this System's catalog`)
        const c = await f.create()
        runtime.register(name, c)
        state.made.set(name, c)
        return ok({ name })
      }],
      [o.remove, async ({ name }, { state }) => {
        runtime.unregister(name)
        await state.made.get(name)?.dispose?.(); state.made.delete(name)
      }],
      [o.connect, (l, { state }) => {
        if (state.links.has(key(l))) return
        const out = opOf(l.from, l.output), into = opOf(l.to, l.op)
        if (!out || !into) return fail('unknown-action', `no ${!out ? `${l.from} ${l.output}` : `${l.to} ${l.op}`}`)
        try { state.links.set(key(l), runtime.connect(l.from, out as Op, l.to, into as Op)) } catch (e: any) { return fail('validation', String(e?.message ?? e)) }
      }],
      [o.disconnect, (l, { state }) => {
        const off = state.links.get(key(l))
        if (!off) return fail('unknown-target', 'no such link made through this System component')
        off(); state.links.delete(key(l))
      }],
      [o.links, () => ok(runtime.links())],
      [o.bind, (b, { state }) => {
        const op = opOf(b.to, b.op)
        if (!op) return fail('unknown-action', `no ${b.to} ${b.op}`)
        try { state.unbinds.set(`${b.from}\u0000${b.dependency}`, runtime.bind(b.from, b.dependency, b.to, op as Op)) } catch (e: any) { return fail('validation', String(e?.message ?? e)) }
      }],
      [o.unbind, (b, { state }) => {
        const k = `${b.from}\u0000${b.dependency}`
        state.unbinds.get(k)?.(); state.unbinds.delete(k)
      }],
      [o.bindings, () => ok(runtime.bindings())],
    ],
  })
  return {
    manifest: factory.manifest,
    create() {
      const m = factory.create()
      let lastLinks = ''
      const announce = () => {
        void m.notify(o.changed, runtime.snapshot().instances)
        const links = runtime.links(), now = JSON.stringify(links)
        if (now !== lastLinks) { lastLinks = now; void m.notify(o.linksChanged, links) }
      }
      const offUpdates = runtime.updates(announce)
      // Link changes made through this component are announced right away.
      const onAction = m.onAction.bind(m)
      m.onAction = async (s, inv) => {
        const r = await onAction(s, inv)
        if (inv.op === o.connect.name || inv.op === o.disconnect.name) announce()
        return r
      }
      const dispose = m.dispose?.bind(m)
      m.dispose = async () => { offUpdates(); await dispose?.() }
      return m
    },
  }
}
