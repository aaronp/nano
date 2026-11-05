import type { Static, TSchema } from 'typebox'
import { bus, environments } from './contexts/bus'
import {
  fail, ok, sameInstance,
  type Component, type ComponentFactory, type Context, type Invocation, type Manifest, type UIComponent,
} from './types'

type Action<I extends TSchema = TSchema> = { name: string; input: I }
type Event = { name: string; schema: TSchema }
type Handler<A extends Action> = (ctx: Context, input: Static<A['input']>, inv: Invocation) => unknown
export type CompositeRoute = { from: [child: string, event: Event]; to: [child: string, action: Action] }

/** A component from a manifest plus one handler per consumed action. A handler's return value becomes the result data. */
function create<const A extends readonly Action[]>(manifest: Manifest, opts: {
  actions: { [K in keyof A]: readonly [A[K], Handler<A[K]>] }
  dispose?: () => void | Promise<void>
}): Component {
  const handlers = new Map<string, Handler<Action>>(opts.actions.map(([a, h]) => [a.name, h as Handler<Action>]))
  for (const a of manifest.consumes) if (!handlers.has(a.name)) throw new Error(`no handler for ${a.name}`)
  return {
    manifest,
    async onAction(ctx, inv) {
      const h = handlers.get(inv.action)
      return h ? ok(await h(ctx, inv.input, inv)) : fail('unknown-action', `no handler for ${inv.action}`)
    },
    dispose: opts.dispose,
  }
}

/** Merge manifests under a new identity. Throws on a duplicate event or action name. */
function manifest(meta: Pick<Manifest, 'id' | 'version'>, ...ms: Manifest[]): Manifest {
  const emits = ms.flatMap(m => m.emits), consumes = ms.flatMap(m => m.consumes)
  const dupes = (ns: string[]) => ns.filter((n, i) => ns.indexOf(n) !== i)
  const d = [...new Set([...dupes(emits.map(e => e.name)), ...dupes(consumes.map(a => a.name))])]
  if (d.length) throw new Error(`compose ${meta.id.author}/${meta.id.id}: duplicate names ${d.join(', ')}`)
  return { ...meta, emits, consumes }
}

/**
 * One component built from named children on a private bus. Actions go to the child that consumes them,
 * child events are routed internally and also bubble out as the composite's own, and `mount` mounts each
 * child UI in declaration order.
 */
function compose(
  meta: Pick<Manifest, 'id' | 'version'>, children: Record<string, ComponentFactory>, routes: CompositeRoute[] = [],
): ComponentFactory {
  const m = manifest(meta, ...Object.values(children).map(f => f.manifest))
  const owner = new Map(Object.entries(children).flatMap(([n, f]) => f.manifest.consumes.map(a => [a.name, n])))
  return {
    manifest: m,
    async create(ctx, self) {
      const inner = bus({ self, parent: ctx })
      const ref = (name: string) => ({ namespace: [...self.namespace, self.instance], instance: name })
      const bubble = (c: Context): Context => ({
        ...c, emit: async (e, p, s) => { const r = await c.emit(e, p, s); return r.type === 'success' ? ctx.emit(e, p, s) : r },
      })
      for (const [name, f] of Object.entries(children)) await inner.register(f, name, bubble)
      for (const { from, to } of routes)
        inner.route({ from: { instance: ref(from[0]), event: from[1].name }, to: { instance: ref(to[0]), action: to[1].name } })
      const component: UIComponent = {
        manifest: m,
        // Addressed to us: delegate by action name. Addressed deeper (a hop): pass it down.
        onAction: (_c, inv) => inner.call(
          sameInstance(inv.target, self) ? ref(owner.get(inv.action)!) : inv.target, inv.action, inv.input, { stack: [...inv.stack, inv] }),
        mount: el => { for (const n of Object.keys(children)) (inner.component(ref(n)) as Partial<UIComponent>)?.mount?.(el) },
        dispose: async () => { for (const i of inner.instances()) await inner.unregister(i) },
      }
      environments.set(component, () => inner.capabilities().environment)
      return component
    },
  }
}

export const Components = { create, compose, manifest }
