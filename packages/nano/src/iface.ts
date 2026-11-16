/**
 * Interfaces: a coordinate plus a set of ops, each named by its key (its coordinate the hash of that name and its
 * schemas), indexed by name and by op coord. A port is one op as offered by one interface, written readably.
 *
 *   const db = Interface.define('acme/db', { get: Op.action(Key, Value) })
 *   port(db, db.ops.get)   // 'acme/db/get'
 *
 * An implementation starts from the contract it provides: `api.impl(coord)` is a builder (`needs`, `config`, each
 * optional, each typing the next step; `description(text)` too; `make` at every step; `create` all at once; `satisfies` for another interface
 * from the same build), ending in `Implementation.define`.
 *
 *   db.impl(acme.implementationId('mem')).needs({ log: Log }).make(({ deps }) => memDb(deps.log))
 */
import type { Static, TSchema } from 'typebox'
import type { NanoContext } from './context.ts'
import type { ImplCoord, InterfaceCoord } from './coord.ts'
import { Implementation, provide, publishSources } from './implementation.ts'
import type { Op } from './op.ts'
import { handlers } from './plain.ts'
import { canonical, hashOf, Schema, type SchemaDef } from './schema.ts'
import type { NanoResult } from './result.ts'
import type { Selector } from './selector.ts'

export type Interface<Ops extends Record<string, Op> = Record<string, Op>> = {
  readonly coord: string
  readonly ops: Ops
  readonly byCoord: ReadonlyMap<string, Op>
  /** A builder of an implementation providing this interface, at `coord` (in the provider's namespace). */
  impl<Self extends Interface>(this: Self, coord: string | ImplCoord): Builder<Self, {}, undefined>
}

type Deps = Record<string, Selector>
/** What `make` gets: the pod's context, and its config. */
type Ctx<D extends Deps, C> = NanoContext<D> & { readonly config: C }
type Lift<I extends Interface, D extends Deps, C> = (ctx: Ctx<D, C>) => Interface.Type<I> | Promise<Interface.Type<I>>
type Built<D extends Deps, C> = Implementation & { satisfies<J extends Interface>(j: J, make: Lift<J, D, C>): Built<D, C> }
type Cfg<S> = S extends TSchema ? Static<S> : undefined
type Builder<I extends Interface, D extends Deps, C> = {
  needs<E extends Deps>(deps: E): Builder<I, E, C>
  config<S extends TSchema>(schema: S): Builder<I, D, Static<S>>
  description(text: string): Builder<I, D, C>
  make(fn: Lift<I, D, C>): Built<D, C>
  create<E extends Deps = {}, S extends TSchema | undefined = undefined>(spec: { needs?: E; config?: S; description?: string; make: Lift<I, E, Cfg<S>> }): Built<E, Cfg<S>>
}

const asDef = (s: TSchema): SchemaDef => ('hash' in s && 'check' in s ? s as SchemaDef : Schema.define(s))
type AnyLift = (ctx: any) => object | Promise<object>

type Steps = { deps: Deps; config?: SchemaDef; description?: string }

function builder(api: Interface, at: string | ImplCoord, steps: Steps = { deps: {} }): Builder<Interface, Deps, unknown> {
  const { deps, config, description } = steps
  const build = (lifts: [Interface, AnyLift][]): Built<Deps, unknown> => Object.assign(Implementation.define(at, {
    provides: lifts.map(([i]) => i),
    dependencies: deps,
    ...(config && { config }),
    ...(description !== undefined && { description }),
    async make(ctx, cfg) {
      const c = Object.assign(Object.create(ctx), { config: cfg })
      const parts = []
      for (const [i, lift] of lifts) {
        const made = await lift(c)
        publishSources(c, i, made)
        parts.push(provide(i, handlers(i, made)))
      }
      return parts
    },
  }), { satisfies: (j: Interface, f: AnyLift) => build([...lifts, [j, f]]) })
  return {
    needs: d => builder(api, at, { ...steps, deps: d }),
    config: s => builder(api, at, { ...steps, config: asDef(s) }),
    description: text => builder(api, at, { ...steps, description: text }),
    make: f => build([[api, f]]),
    create: spec => builder(api, at, {
      deps: spec.needs ?? {}, ...(spec.config && { config: asDef(spec.config) }), ...(spec.description !== undefined && { description: spec.description }),
    }).make(spec.make as never),
  } as Builder<Interface, Deps, unknown>
}

export const COORD = /^[a-zA-Z][a-zA-Z0-9-]*([./][a-zA-Z0-9-]+)+$/

/** A port: `<interface>/<op name>`. Handlers are keyed by it; op hashes only check that two ports fit. */
export const port = (i: Interface, o: Op): string => `${i.coord}/${o.name}`

type Unnamed = Omit<Op, 'name' | 'coord'>
type Named<U extends Record<string, Unnamed>> = { [K in keyof U]: U[K] & { readonly name: K & string; readonly coord: string } }

function define<U extends Record<string, Unnamed>>(at: string | InterfaceCoord, unnamed: U): Interface<Named<U>> {
  const coord = String(at)
  if (!COORD.test(coord)) throw new Error(`bad interface coordinate ${coord}`)
  const ops = Object.fromEntries(Object.entries(unnamed).map(([name, o]) =>
    [name, { ...o, name, coord: hashOf(canonical({ name, input: o.input?.hash ?? null, output: o.output!.hash })) }])) as Named<U>
  const api: Interface<Named<U>> = { coord, ops, byCoord: new Map(Object.values(ops).map(o => [o.coord, o])), impl: at => builder(api, at) as never }
  return api
}

type Data<D> = NonNullable<D> extends { schema: infer S extends TSchema } ? Static<S> : never

/** Typed caller for an interface: each action is an async function. Events have none: they are published. */
export type Client<I extends Interface> = {
  [K in keyof I['ops'] as I['ops'][K]['kind'] extends 'event' ? never : K]: (input: Data<I['ops'][K]['input']>) => Promise<NanoResult<Data<I['ops'][K]['output']>>>
}

type Ops<I extends Interface> = I['ops']
type In<I extends Interface, K extends keyof Ops<I>> = Data<Ops<I>[K]['input']>
type Out<I extends Interface, K extends keyof Ops<I>> = Data<Ops<I>[K]['output']>

/** `Interface.define(coord, ops)`. */
export const Interface = { define }

export declare namespace Interface {
  /** The plain object an interface describes: an input that is only `null` is no argument, an output that is only
   *  `null` is `void`. An event is a source: a method giving its data as an AsyncIterable. */
  type Type<I extends Interface> = {
    [K in keyof Ops<I>]: Ops<I>[K]['kind'] extends 'event' ? () => AsyncIterable<Out<I, K>>
      : (...args: [In<I, K>] extends [null] ? [] : [input: In<I, K>]) => Promise<[Out<I, K>] extends [null] ? void : Out<I, K>>
  }
}
