/**
 * Runtime: which pods are placed together and how they are wired, checked over a `Pods` scope, as an immutable value.
 * A call edge says which pod a pod's code may reach; a pipe carries an event, or an action's results, of `from` into
 * an action of `to`. Pipes may form cycles.
 *
 *   Runtime.create('chat', { pods: ['a', 'b'], subscriptions: [{ kind: 'call', from: 'a', to: 'b' }] }, scope)
 *   // success({ id: 'chat', pods: scope, deployment() }), or invalid-input naming the offender; never throws
 */
import { Type } from 'typebox'
import { port } from './iface.ts'
import type { Implementation } from './implementation.ts'
import type { Op } from './op.ts'
import { fits } from './op.ts'
import { originOf, shapeError, type Pods } from './pods.ts'
import { failure, success, type NanoResult } from './result.ts'

export type Subscription =
  | { kind: 'call'; from: string; to: string }
  | { kind: 'pipe'; from: string; source: string; to: string; target: string }

export type RuntimeDeployment = { pods: string[]; subscriptions: Subscription[]; policy?: 'allow-all' }

export type Runtime = { readonly id: string; readonly pods: Pods; deployment(): RuntimeDeployment }

const strict = { additionalProperties: false } as const
const Shape = Type.Object({
  pods: Type.Array(Type.String()),
  subscriptions: Type.Array(Type.Union([
    Type.Object({ kind: Type.Literal('call'), from: Type.String(), to: Type.String() }, strict),
    Type.Object({ kind: Type.Literal('pipe'), from: Type.String(), source: Type.String(), to: Type.String(), target: Type.String() }, strict),
  ]), { maxItems: 2000 }),
  policy: Type.Optional(Type.Literal('allow-all')),
}, strict)

const label = (s: Subscription) => (s.kind === 'call' ? `${s.from}->${s.to}` : `${s.from}->${s.to} (${s.source} to ${s.target})`)

/** The op at port `p` among what `impl` provides. */
const opAt = (impl: Implementation, p: string): Op | undefined =>
  impl.provides.flatMap(i => Object.values(i.ops).filter(o => port(i, o) === p))[0]

/** Why subscription `s` (both ends known) does not hold, or undefined. */
function unfit(s: Subscription, from: Implementation, to: Implementation): string | undefined {
  if (s.kind === 'call') {
    const deps = Object.values(from.dependencies).flatMap(d => (d.implements === undefined ? [] : [d.implements]))
    return deps.length && !to.provides.some(i => deps.includes(i.coord)) ? `${s.to} provides none of ${s.from}'s dependencies` : undefined
  }
  const source = opAt(from, s.source), target = opAt(to, s.target)
  if (!source) return `${s.source} is not an event or action of ${s.from}`
  if (target?.kind !== 'action') return `${s.target} is not an action of ${s.to}`
  return fits(source, target) ? undefined : `${s.source} does not fit ${s.target}`
}

function check(id: string, r: RuntimeDeployment, pods: Pods): string | undefined {
  const registry = originOf(pods)?.registry
  if (!registry) return `runtime ${id}: its pods do not come from Pods.create`
  const placed = new Set(r.pods), seen = new Set<string>()
  for (const [i, name] of r.pods.entries()) {
    if (!pods.get(name)) return `runtime ${id}: no pod ${name}`
    if (r.pods.indexOf(name) !== i) return `runtime ${id}: ${name} is placed twice`
  }
  for (const s of r.subscriptions) {
    const end = [s.from, s.to].find(n => !placed.has(n))
    if (end !== undefined) return `runtime ${id}: ${label(s)}: ${end} is not placed here`
    const key = JSON.stringify(s.kind === 'call' ? [s.from, s.to] : [s.from, s.to, s.source, s.target])
    if (seen.has(key)) return `runtime ${id}: ${label(s)} is there twice`
    seen.add(key)
    const impl = (n: string) => registry.implementation(pods.get(n)!.implementation)!
    const why = unfit(s, impl(s.from), impl(s.to))
    if (why) return `runtime ${id}: ${label(s)}: ${why}`
  }
}

/** Runtime `id` placing and wiring pods of `pods`, if `d` checks out. Never throws. */
function create(id: string, d: unknown, pods: Pods): NanoResult<Runtime> {
  try {
    const copy = structuredClone(d)
    const why = shapeError(Shape, copy, `runtime ${id}`) ?? check(id, copy as RuntimeDeployment, pods)
    if (why) return failure('invalid-input', why)
    return success(Object.freeze({ id, pods, deployment: () => structuredClone(copy as RuntimeDeployment) }))
  } catch (e) {
    return failure('invalid-input', `unreadable runtime ${id}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export const Runtime = { create }
