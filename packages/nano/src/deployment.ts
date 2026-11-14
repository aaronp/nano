/**
 * Deployments: the whole system as data — pods by name, runtimes (named sections: the pods placed there, the
 * subscriptions between them, a policy) and tags. `nano.json` is a deployment, serialised.
 *
 *   const d = { pods: { db: Pod.lazy(kv) }, runtimes: { app: { pods: ['db'], subscriptions: [] } } }
 *   checkDeployment(d, registry)   // success(d), or invalid-input / not-found naming the offender; never throws
 */
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { port } from './iface.ts'
import type { Implementation } from './implementation.ts'
import type { Op, OpKind } from './op.ts'
import { fits } from './op.ts'
import type { Pod } from './pod.ts'
import type { Registry } from './registry.ts'
import { failure, success, type NanoResult } from './result.ts'

export type Subscription =
  | { kind: 'call'; from: string; to: string }
  | { kind: 'event'; from: string; source: string; to: string; target: string }

export type Deployment = {
  pods: Record<string, Pod>
  runtimes: Record<string, { pods: string[]; subscriptions: Subscription[]; policy?: 'allow-all' }>
  tags?: Record<string, string[]>
}

/** Pod names and runtime ids. */
const ID = /^[^/\s#\x00-\x1f\x7f]{1,64}$/
const Id = Type.String({ pattern: ID.source })
const strict = { additionalProperties: false } as const
const Shape = Type.Object({
  pods: Type.Record(Id, Type.Object({ implementation: Type.String(), config: Type.Optional(Type.Unknown()), eager: Type.Boolean() }, strict),
    { ...strict, maxProperties: 5000 }),
  runtimes: Type.Record(Id, Type.Object({
    pods: Type.Array(Id),
    subscriptions: Type.Array(Type.Union([
      Type.Object({ kind: Type.Literal('call'), from: Id, to: Id }, strict),
      Type.Object({ kind: Type.Literal('event'), from: Id, source: Type.String(), to: Id, target: Type.String() }, strict),
    ]), { maxItems: 2000 }),
    policy: Type.Optional(Type.Literal('allow-all')),
  }, strict), { ...strict, maxProperties: 50 }),
  tags: Type.Optional(Type.Record(Id, Type.Array(Type.String()), strict)),
}, strict)

const label = (s: Subscription) => (s.kind === 'call' ? `${s.from}->${s.to}` : `${s.from}->${s.to} (${s.source} to ${s.target})`)

/** The op at port `p` of kind `kind` among what `impl` provides. */
const opAt = (impl: Implementation, p: string, kind: OpKind): Op | undefined =>
  impl.provides.flatMap(i => Object.values(i.ops).filter(o => o.kind === kind && port(i, o) === p))[0]

/** Why subscription `s` (both ends known) does not hold, or undefined. */
function unfit(s: Subscription, from: Implementation, to: Implementation): string | undefined {
  if (s.kind === 'call') {
    const deps = Object.values(from.dependencies).flatMap(d => (d.implements === undefined ? [] : [d.implements]))
    return deps.length && !to.provides.some(i => deps.includes(i.coord)) ? `${s.to} provides none of ${s.from}'s dependencies` : undefined
  }
  const source = opAt(from, s.source, 'event'), target = opAt(to, s.target, 'action')
  if (!source) return `${s.source} is not an event of ${s.from}`
  if (!target) return `${s.target} is not an action of ${s.to}`
  return fits(source, target) ? undefined : `${s.source} does not fit ${s.target}`
}

function check(d: Deployment, registry: Registry): NanoResult<Deployment> {
  const impls = new Map<string, Implementation>()
  for (const [name, p] of Object.entries(d.pods)) {
    const impl = registry.implementation(p.implementation)
    if (!impl) return failure('not-found', `pod ${name}: no implementation ${p.implementation}`)
    if (impl.config && !impl.config.check(p.config)) return failure('invalid-input', `pod ${name}: config does not fit ${impl.config.type}`)
    impls.set(name, impl)
  }
  for (const [id, r] of Object.entries(d.runtimes)) {
    const placed = new Set(r.pods), seen = new Set<string>()
    for (const name of r.pods) if (!impls.has(name)) return failure('invalid-input', `runtime ${id}: no pod ${name}`)
    for (const s of r.subscriptions) {
      const end = [s.from, s.to].find(n => !placed.has(n))
      if (end !== undefined) return failure('invalid-input', `runtime ${id}: ${label(s)}: ${end} is not placed here`)
      const key = JSON.stringify(s.kind === 'call' ? [s.from, s.to] : [s.from, s.to, s.source, s.target])
      if (seen.has(key)) return failure('invalid-input', `runtime ${id}: ${label(s)} is there twice`)
      seen.add(key)
      const why = unfit(s, impls.get(s.from)!, impls.get(s.to)!)
      if (why) return failure('invalid-input', `runtime ${id}: ${label(s)}: ${why}`)
    }
  }
  return success(d)
}

/** `d` as a deployment, if its shape holds and every name, port, implementation and config checks out. Never throws. */
export function checkDeployment(d: unknown, registry: Registry): NanoResult<Deployment> {
  try {
    const e = Value.Errors(Shape, d)[0]
    const why = e?.message === 'schema is false' ? 'not allowed here (an unknown key, or a name breaking the id rule)' : e?.message
    if (e) return failure('invalid-input', `deployment ${e.instancePath || '/'}: ${why}`)
    return check(d as Deployment, registry)
  } catch (e) {
    return failure('invalid-input', `unreadable deployment: ${e instanceof Error ? e.message : String(e)}`)
  }
}
