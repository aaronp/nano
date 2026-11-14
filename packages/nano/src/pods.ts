/**
 * Pods: which components exist, as a checked, immutable lookup of pod descriptions by name. Building one builds
 * nothing; `select` gives a scope over the same descriptions.
 *
 *   const pods = Pods.create({ a: Pod.lazy(counter), b: Pod.eager(ticker) }, { registry, tags: { a: ['primary'] } })   // NanoResult<Pods>
 *   pods.value.select(['a'])   // success(a Pods naming only 'a'); an unknown name is not-found
 */
import { Type, type TSchema } from 'typebox'
import { Value } from 'typebox/value'
import type { Pod } from './pod.ts'
import type { Registry } from './registry.ts'
import { failure, success, type NanoResult } from './result.ts'

export type PodDeployment = Record<string, Pod>

export type Pods = {
  names(): string[]
  get(name: string): Pod | undefined
  select(names: string[]): NanoResult<Pods>
  deployment(): PodDeployment
}

/** Pod names and runtime ids. */
export const Id = Type.String({ pattern: /^[^/\s#\x00-\x1f\x7f]{1,64}$/.source })
const strict = { additionalProperties: false } as const
const Shape = Type.Record(Id, Type.Object({ implementation: Type.String(), config: Type.Optional(Type.Unknown()), eager: Type.Boolean() }, strict),
  { ...strict, maxProperties: 5000 })
const Tags = Type.Record(Id, Type.Array(Type.String()), strict)

/** The first way `d` breaks `schema`, as a reason naming `what`; or undefined. */
export function shapeError(schema: TSchema, d: unknown, what: string): string | undefined {
  const e = Value.Errors(schema, d)[0]
  if (!e) return undefined
  const why = e.message === 'schema is false' ? 'not allowed here (an unknown key, or a name breaking the id rule)' : e.message
  return `${what} ${e.instancePath || '/'}: ${why}`
}

type Tags = Record<string, string[]>
/**
 * Where a `Pods` comes from: the registry it was checked against, the `Pods.create` result it was selected from, and
 * the tags of its pods, when `Pods.create` was given tags; and its descriptions by name, to read without copying.
 */
type Origin = { readonly registry: Registry; readonly root: Pods; readonly tags?: Tags; readonly pods: ReadonlyMap<string, Pod> }
/** Each `Pods`' origin, for `Runtime.create` and `Application.create`: carried, not a member. */
const origins = new WeakMap<Pods, Origin>()
export const originOf = (pods: Pods): Origin | undefined => origins.get(pods)

function view(all: ReadonlyMap<string, Pod>, registry: Registry, root?: Pods, tags?: Tags): Pods {
  const pods: Pods = Object.freeze({
    names: () => [...all.keys()],
    get: (name: string) => structuredClone(all.get(name)),
    select(names: string[]) {
      if (!Array.isArray(names) || names.some(n => typeof n !== 'string')) return failure('invalid-input', 'select takes pod names')
      const seen = new Set<string>(), dup = names.find(n => seen.size === seen.add(n).size), unknown = names.find(n => !all.has(n))
      if (dup !== undefined) return failure('invalid-input', `pod ${dup} is selected twice`)
      if (unknown !== undefined) return failure('not-found', `no pod ${unknown}`)
      const kept = tags && Object.fromEntries(names.filter(n => Object.hasOwn(tags, n)).map(n => [n, tags[n]!]))
      return success(view(new Map(names.map(n => [n, all.get(n)!])), registry, root ?? pods, kept))
    },
    deployment: () => structuredClone(Object.fromEntries(all)),
  })
  origins.set(pods, Object.freeze({ registry, root: root ?? pods, ...(tags && { tags }), pods: all }))
  return pods
}

/** `d` as `Pods`, if its names, implementations, configs, size and `tags` (by pod name, each a pod of `d`) check out. Never throws. */
function create(d: unknown, opts: { registry: Registry; tags?: Tags }): NanoResult<Pods> {
  try {
    const copy = structuredClone(d), tags = structuredClone(opts.tags)
    const why = shapeError(Shape, copy, 'pods') ?? (tags === undefined ? undefined : shapeError(Tags, tags, 'tags'))
    if (why) return failure('invalid-input', why)
    const stray = Object.keys(tags ?? {}).find(n => !Object.hasOwn(copy as object, n))
    if (stray !== undefined) return failure('invalid-input', `tags: no pod ${stray}`)
    for (const [name, p] of Object.entries(copy as PodDeployment)) {
      const impl = opts.registry.implementation(p.implementation)
      if (!impl) return failure('not-found', `pod ${name}: no implementation ${p.implementation}`)
      if (impl.config && !impl.config.check(p.config)) return failure('invalid-input', `pod ${name}: config does not fit ${impl.config.type}`)
    }
    return success(view(new Map(Object.entries(copy as PodDeployment)), opts.registry, undefined, tags))
  } catch (e) {
    return failure('invalid-input', `unreadable pods: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export const Pods = { create }
