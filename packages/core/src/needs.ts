// Typed interfaces, components that name what they need, and clients that call a need through its binding.
//   design time:  define('ns/name', Interface, { need: Interface }, deps => implementation)
//   run time:     registry.add the instance, then registry.bind each need to a coord
import type { Static, TSchema } from 'typebox'
import { Components, type Component } from './component'
import { isOk, Ops, type Interface, type Op } from './data'
import type { Environment } from './env'

export type OpSpec = { in: TSchema; out: TSchema; description?: string }
type Spec = Record<string, OpSpec>

/** A named set of typed ops. Implementations share its op keys (`<id>/<op>`), so any one can stand in for another. */
export type Iface<S extends Spec = Spec> = Interface & { spec: S }
export const iface = <S extends Spec>(id: string, spec: S): Iface<S> => ({
  id, spec,
  ops: Object.fromEntries(Object.entries(spec).map(([k, o]) => [k, Ops.action(id, k, o.in, o.out, { description: o.description })])),
})

type Fns<S extends Spec, R> = { [K in keyof S]: (arg: Static<S[K]['in']>) => R extends 'async' ? Promise<Static<S[K]['out']>> : Static<S[K]['out']> | Promise<Static<S[K]['out']>> }
/** How code sees an interface it needs: one async function per op. */
export type Client<I> = I extends Iface<infer S> ? Fns<S, 'async'> : never
type Impl<I> = I extends Iface<infer S> ? Fns<S, 'sync-or-async'> : never
type Needs = Record<string, Interface>
export type Clients<D extends Needs> = { [K in keyof D]: Client<D[K]> }

/** A client per need: each op calls through the need's binding, read at call time. An error throws. */
export function clients<D extends Needs>(env: Environment, needs: D): Clients<D> {
  return Object.fromEntries(Object.entries(needs).map(([name, i]) => [name, Object.fromEntries(Object.entries(i.ops).map(([k, op]) => [k, async (arg: unknown) => {
    const r = await env.use(name, op, arg)
    if (!isOk(r)) throw new Error(r.error)
    return r.value
  }]))])) as Clients<D>
}

/** A component that implements an interface, with code given clients for what it needs. */
export function define<I extends Iface, D extends Needs>(id: string, implements_: I, needs: D, make: (deps: Clients<D>) => Impl<I>, opts: { description?: string } = {}): Component {
  const at = id.lastIndexOf('/')
  const c = Components.create({ ns: id.slice(0, at), name: id.slice(at + 1) }, env => make(clients(env, needs)) as Record<string, (a: unknown) => unknown>,
    { ...opts, needs, implements: [implements_] })
  for (const [k, op] of Object.entries(implements_.ops) as [string, Op][]) c.action(op, (impl, arg) => impl[k]!(arg))
  return c
}
