/**
 * Pods: which components exist, as a checked, immutable lookup of pod descriptions by name. Building one builds
 * nothing; `select` gives a scope over the same descriptions.
 *
 *   const pods = Pods.create({ a: Pod.lazy(counter), b: Pod.eager(ticker) }, { registry })   // NanoResult<Pods>
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

/** The first way `d` breaks `schema`, as a reason naming `what`; or undefined. */
export function shapeError(schema: TSchema, d: unknown, what: string): string | undefined {
  const e = Value.Errors(schema, d)[0]
  if (!e) return undefined
  const why = e.message === 'schema is false' ? 'not allowed here (an unknown key, or a name breaking the id rule)' : e.message
  return `${what} ${e.instancePath || '/'}: ${why}`
}

/** The registry each `Pods` was checked against, for `Runtime.create`: carried, not a member. */
const registries = new WeakMap<Pods, Registry>()
export const registryOf = (pods: Pods): Registry | undefined => registries.get(pods)

function view(all: ReadonlyMap<string, Pod>, registry: Registry): Pods {
  const pods: Pods = Object.freeze({
    names: () => [...all.keys()],
    get: (name: string) => structuredClone(all.get(name)),
    select(names: string[]) {
      if (!Array.isArray(names) || names.some(n => typeof n !== 'string')) return failure('invalid-input', 'select takes pod names')
      const dup = names.find((n, i) => names.indexOf(n) !== i), unknown = names.find(n => !all.has(n))
      if (dup !== undefined) return failure('invalid-input', `pod ${dup} is selected twice`)
      if (unknown !== undefined) return failure('not-found', `no pod ${unknown}`)
      return success(view(new Map(names.map(n => [n, all.get(n)!])), registry))
    },
    deployment: () => structuredClone(Object.fromEntries(all)),
  })
  registries.set(pods, registry)
  return pods
}

/** `d` as `Pods`, if its names, implementations, configs and size check out. Never throws. */
function create(d: unknown, opts: { registry: Registry }): NanoResult<Pods> {
  try {
    const copy = structuredClone(d)
    const why = shapeError(Shape, copy, 'pods')
    if (why) return failure('invalid-input', why)
    for (const [name, p] of Object.entries(copy as PodDeployment)) {
      const impl = opts.registry.implementation(p.implementation)
      if (!impl) return failure('not-found', `pod ${name}: no implementation ${p.implementation}`)
      if (impl.config && !impl.config.check(p.config)) return failure('invalid-input', `pod ${name}: config does not fit ${impl.config.type}`)
    }
    return success(view(new Map(Object.entries(copy as PodDeployment)), opts.registry))
  } catch (e) {
    return failure('invalid-input', `unreadable pods: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export const Pods = { create }
