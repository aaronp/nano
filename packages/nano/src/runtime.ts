/**
 * Runtime: which pods are placed together and how they are wired, checked over a `Pods` scope, as an immutable value.
 * A call edge says which pod a pod's code may reach (`from` may be placed in another runtime; its calls travel here); a pipe carries an event, or an action's results, of `from` into
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
import { Rule } from './policy.ts'
import { originOf, shapeError, type Pods } from './pods.ts'
import { failure, success, type NanoResult } from './result.ts'

export type Subscription =
  | { kind: 'call'; from: string; to: string; ops?: { source: string; target: string }[] }
  | { kind: 'pipe'; from: string; source: string; to: string; target: string }

export type RuntimeDeployment = { pods: string[]; subscriptions: Subscription[]; policy?: { kind: 'allow-all' } | { kind: 'rules'; rules: Rule[] } }

export type Runtime = { readonly id: string; readonly pods: Pods; deployment(): RuntimeDeployment }

const strict = { additionalProperties: false } as const
const Shape = Type.Object({
  pods: Type.Array(Type.String()),
  subscriptions: Type.Array(Type.Union([
    Type.Object({ kind: Type.Literal('call'), from: Type.String(), to: Type.String(),
      ops: Type.Optional(Type.Array(Type.Object({ source: Type.String(), target: Type.String() }, strict), { maxItems: 2000 })) }, strict),
    Type.Object({ kind: Type.Literal('pipe'), from: Type.String(), source: Type.String(), to: Type.String(), target: Type.String() }, strict),
  ]), { maxItems: 2000 }),
  policy: Type.Optional(Type.Union([
    Type.Object({ kind: Type.Literal('allow-all') }, strict),
    Type.Object({ kind: Type.Literal('rules'), rules: Type.Array(Rule, { maxItems: 2000 }) }, strict),
  ])),
}, strict)

const label = (s: Subscription) => (s.kind === 'call' ? `${s.from}->${s.to}` : `${s.from}->${s.to} (${s.source} to ${s.target})`)

/** The op at port `p` among what `impl` provides (its ports mapped once per implementation). */
const ports = new WeakMap<Implementation, Map<string, Op>>()
export const opAt = (impl: Implementation, p: string): Op | undefined => {
  let m = ports.get(impl)
  if (!m) { m = new Map(); for (const i of impl.provides) for (const o of Object.values(i.ops)) if (!m.has(port(i, o))) m.set(port(i, o), o); ports.set(impl, m) }
  return m.get(p)
}

/** Why subscription `s` (both ends known) does not hold, or undefined. */
function unfit(s: Subscription, from: Implementation, to: Implementation): string | undefined {
  if (s.kind === 'call') {
    const deps = Object.values(from.dependencies).flatMap(d => (d.implements === undefined ? [] : [d.implements]))
    if (deps.length && !to.provides.some(i => deps.includes(i.coord))) return `${s.to} provides none of ${s.from}'s dependencies`
    const pairs = new Set<string>()
    for (const o of s.ops ?? []) {
      if (!opAt(from, o.source)) return `${o.source} is not an op of ${s.from}`
      if (opAt(to, o.target)?.kind !== 'action') return `${o.target} is not an action of ${s.to}`
      if (pairs.size === pairs.add(JSON.stringify([o.source, o.target])).size) return `${o.source} to ${o.target} is there twice`
    }
    return undefined
  }
  const source = opAt(from, s.source), target = opAt(to, s.target)
  if (!source) return `${s.source} is not an event or action of ${s.from}`
  if (target?.kind !== 'action') return `${s.target} is not an action of ${s.to}`
  return fits(source, target) ? undefined : `${s.source} does not fit ${s.target}`
}

function check(id: string, r: RuntimeDeployment, pods: Pods): string | undefined {
  const origin = originOf(pods)
  if (!origin) return `runtime ${id}: its pods do not come from Pods.create`
  const placed = new Set<string>(), seen = new Set<string>()
  for (const name of r.pods) {
    if (!origin.pods.has(name)) return `runtime ${id}: no pod ${name}`
    if (placed.size === placed.add(name).size) return `runtime ${id}: ${name} is placed twice`
  }
  for (const s of r.subscriptions) {
    if (!origin.pods.has(s.from)) return `runtime ${id}: ${label(s)}: no pod ${s.from}`
    const end = (s.kind === 'call' ? [s.to] : [s.from, s.to]).find(n => !placed.has(n))   // a call may come from outside
    if (end !== undefined) return `runtime ${id}: ${label(s)}: ${end} is not placed here`
    const key = JSON.stringify(s.kind === 'call' ? [s.from, s.to] : [s.from, s.to, s.source, s.target])
    if (seen.has(key)) return `runtime ${id}: ${label(s)} is there twice`
    seen.add(key)
    const impl = (n: string) => origin.registry.implementation(origin.pods.get(n)!.implementation)!
    const why = unfit(s, impl(s.from), impl(s.to))
    if (why) return `runtime ${id}: ${label(s)}: ${why}`
  }
}

/** Every value `Runtime.create` made: carried, not a member, so `Application.create` can tell a Runtime from a look-alike. */
const made = new WeakSet<Runtime>()
export const isRuntime = (r: unknown): r is Runtime => made.has(r as Runtime)

/** Runtime `id` placing and wiring pods of `pods`, if `d` checks out. Never throws. */
function create(id: string, d: unknown, pods: Pods): NanoResult<Runtime> {
  try {
    const copy = structuredClone(d)
    const why = shapeError(Shape, copy, `runtime ${id}`) ?? check(id, copy as RuntimeDeployment, pods)
    if (why) return failure('invalid-input', why)
    const runtime: Runtime = Object.freeze({ id, pods, deployment: () => structuredClone(copy as RuntimeDeployment) })
    made.add(runtime)
    return success(runtime)
  } catch (e) {
    return failure('invalid-input', `unreadable runtime ${id}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export const Runtime = { create }
