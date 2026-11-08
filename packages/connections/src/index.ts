/**
 * Connections between component instances, as data you can save and share, kept separate from the components
 * themselves and from creating instances:
 *   - a Connection is pub/sub intent: whatever its source selects feeds whatever its target selects (fanning out);
 *   - a Workflow is a chain: each step's outcome feeds the next step's op, active only while the whole chain is viable.
 * `plan` (pure) turns intents plus the instances present into the routes they want and a status per intent;
 * an orchestrator keeps a scope's routes matching the plan as instances come and go.
 */
import { canonicalType, fail, missing, ok, providerOf, typeHash, type Component, type ComponentId, type Instance, type Op, type Result, type SystemRuntime } from '@composable/sdk'

// ---------------------------------------------------------------- data

/** Which instances. */
export type InstanceSel = { by: 'name'; name: string } | { by: 'component'; id: ComponentId } | { by: 'any' }
/** Which of a source's outputs (publications and action outcomes). */
export type OutputSel = { by: 'name'; name: string } | { by: 'type'; type: string } | { by: 'outputs' }

export type Connection = {
  kind: 'connection'; id: string; enabled?: boolean
  from: { select: InstanceSel; output: OutputSel }
  to: { select: InstanceSel; op: string }
}
/** A chain: step 0's output feeds step 1's op, whose outcome feeds step 2's, and so on. */
export type Workflow = { kind: 'workflow'; id: string; enabled?: boolean; steps: { select: InstanceSel; op: string }[] }
export type Intent = Connection | Workflow

// ---------------------------------------------------------------- plan

export type Problem =
  | { kind: 'no-match'; at: string }                                    // the selector matches no instance
  | { kind: 'ambiguous'; at: string; instances: string[] }              // a workflow step matches several
  | { kind: 'no-op'; at: string; op: string }                           // the instance has no such op (with the needed input/output)
  | { kind: 'type-mismatch'; at: string; output: string; input: string } // type SAIDs that do not fit
  | { kind: 'unavailable'; at: string; needs: string[] }                // the op's dependencies have no provider
export type Status = { enabled: boolean; viable: boolean; routes: number; problems: Problem[] }
export type PlannedRoute = { intent: string; from: string; output: Op; to: string; op: Op }
export type Plan = { routes: PlannedRoute[]; status: Record<string, Status> }

const matches = (sel: InstanceSel, i: Instance) =>
  sel.by === 'any' ? true
    : sel.by === 'name' ? i.id === sel.name
      : sel.by === 'component' ? i.manifest.id.author === sel.id.author && i.manifest.id.id === sel.id.id
        : (() => { throw new Error(`unknown selector ${JSON.stringify(sel)}`) })()

/** An input of `{}` (Unknown / Any) takes anything; otherwise the type SAIDs must be equal. */
export const fits = (output: Op, op: Op) =>
  !!output.output && !!op.input && (Object.keys(canonicalType(op.input) as object).length === 0 || typeHash(output.output) === typeHash(op.input))

const mismatch = (at: string, output: Op, op: Op): Problem =>
  ({ kind: 'type-mismatch', at, output: typeHash(output.output!), input: typeHash(op.input!) })

function planConnection(c: Connection, instances: Instance[]): { routes: PlannedRoute[]; problems: Problem[] } {
  const sources = instances.filter(i => matches(c.from.select, i)), targets = instances.filter(i => matches(c.to.select, i))
  const problems: Problem[] = []
  if (!sources.length) problems.push({ kind: 'no-match', at: 'from' })
  if (!targets.length) problems.push({ kind: 'no-match', at: 'to' })
  const routes: PlannedRoute[] = []
  for (const t of targets) {
    const op = t.manifest.ops.find(o => o.name === c.to.op && o.input)
    if (!op) { problems.push({ kind: 'no-op', at: `to ${t.id}`, op: c.to.op }); continue }
    const needs = missing(op, t.manifest, instances, t.id)
    if (needs.length) { problems.push({ kind: 'unavailable', at: `to ${t.id}`, needs }); continue }
    for (const s of sources) {
      if (s.id === t.id) continue // never feed an instance its own output
      const outs = s.manifest.ops.filter(o => o.output && (
        c.from.output.by === 'outputs' || (c.from.output.by === 'name' ? o.name === c.from.output.name : typeHash(o.output!) === c.from.output.type)))
      if (c.from.output.by === 'name' && !outs.length) problems.push({ kind: 'no-op', at: `from ${s.id}`, op: c.from.output.name })
      for (const out of outs) {
        if (fits(out, op)) routes.push({ intent: c.id, from: s.id, output: out, to: t.id, op })
        else if (c.from.output.by === 'name') problems.push(mismatch(`${s.id} → ${t.id}`, out, op))
      }
    }
  }
  return { routes, problems }
}

function planWorkflow(w: Workflow, instances: Instance[]): { routes: PlannedRoute[]; problems: Problem[] } {
  const problems: Problem[] = []
  const steps = w.steps.map((step, i) => {
    const found = instances.filter(x => matches(step.select, x))
    if (!found.length) { problems.push({ kind: 'no-match', at: `step ${i}` }); return undefined }
    if (found.length > 1) { problems.push({ kind: 'ambiguous', at: `step ${i}`, instances: found.map(x => x.id) }); return undefined }
    const op = found[0].manifest.ops.find(o => o.name === step.op && (i === 0 || o.input) && (i === w.steps.length - 1 || o.output))
    if (!op) { problems.push({ kind: 'no-op', at: `step ${i}`, op: step.op }); return undefined }
    const needs = i > 0 ? missing(op, found[0].manifest, instances, found[0].id) : []
    if (needs.length) { problems.push({ kind: 'unavailable', at: `step ${i}`, needs }); return undefined }
    return { instance: found[0].id, op }
  })
  const routes: PlannedRoute[] = []
  for (let i = 0; i + 1 < steps.length; i++) {
    const a = steps[i], b = steps[i + 1]
    if (!a || !b) continue
    if (fits(a.op, b.op)) routes.push({ intent: w.id, from: a.instance, output: a.op, to: b.instance, op: b.op })
    else problems.push(mismatch(`step ${i} → ${i + 1}`, a.op, b.op))
  }
  return { routes: problems.length ? [] : routes, problems }
}

/** The routes `intents` want given the instances present, and a status per intent. Pure. */
export function plan(intents: readonly Intent[], instances: readonly Instance[]): Plan {
  const out: Plan = { routes: [], status: {} }
  for (const it of intents) {
    const enabled = it.enabled !== false
    const r = it.kind === 'connection' ? planConnection(it, [...instances])
      : it.kind === 'workflow' ? planWorkflow(it, [...instances])
        : (() => { throw new Error(`unknown intent ${JSON.stringify(it)}`) })()
    out.status[it.id] = { enabled, viable: r.routes.length > 0, routes: r.routes.length, problems: r.problems }
    if (enabled) out.routes.push(...r.routes)
  }
  return out
}

// ---------------------------------------------------------------- orchestrator

export type Orchestrator = {
  /** The status of each intent as of the last change. */
  status(): Record<string, Status>
  onStatus(fn: (s: Record<string, Status>) => void): () => void
  /** Replace the intents (e.g. a loaded document, or one switched on or off). */
  set(intents: readonly Intent[]): void
  /** Remove every route this orchestrator made, and stop following changes. */
  stop(): void
}

/** A component with no ops that runs `apply` whenever its System changes: the shape every policy here takes. */
const policyComponent = (id: string, apply: () => void): Component => ({
  manifest: { id: { author: 'composable', id }, ops: [] },
  onAction: async () => fail('unknown-action', `${id} takes no calls`),
  onSystemUpdated: () => apply(),
})

/**
 * A policy: keep `system` wired to match `intents`. It registers itself (as `id`), re-plans on every change, and
 * adds or removes only the links it made. It never creates instances.
 */
function create(system: SystemRuntime, intents: readonly Intent[], id = 'orchestrator'): Result<Orchestrator> {
  const mine = new Map<string, string>() // route key -> subscription id
  const listeners = new Set<(s: Record<string, Status>) => void>()
  let current = intents, status: Record<string, Status> = {}, stopped = false, applying = false, dirty = false
  const key = (r: PlannedRoute) => `${r.from}\u0000${r.output.name}\u0000${r.to}\u0000${r.op.name}`
  const apply = () => {
    if (stopped) return
    if (applying) { dirty = true; return } // our own subscribe/unsubscribe deltas come back here; re-plan after
    applying = true
    try { for (let i = 0; i === 0 || (dirty && i < 10); i++) { dirty = false; reconcile() } } finally { applying = false; dirty = false }
    for (const fn of listeners) try { fn(status) } catch {}
  }
  const reconcile = () => {
    const p = plan(current, system.snapshot().instances)
    const want = new Map(p.routes.map(r => [key(r), r]))
    for (const [k, sid] of mine) if (!want.has(k)) { system.unsubscribe(sid); mine.delete(k) }
    for (const [k, r] of want) if (!mine.has(k)) { const s = system.subscribe({ source: r.from, op: r.output.name, listener: r.to, target: r.op.name }); if (s.type === 'success') mine.set(k, s.data.id) }
    status = p.status
  }
  const reg = system.register(id, policyComponent('orchestrator', apply))
  if (reg.type !== 'success') return reg
  apply()
  return ok({
    status: () => status,
    onStatus(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    set(next) { current = next; apply() },
    stop() { stopped = true; system.unregister(id); for (const sid of mine.values()) system.unsubscribe(sid); mine.clear() },
  })
}

export const Orchestrators = { create }

/**
 * A policy: bind every unbound dependency in `system` to the first instance that provides it (by shape), and again
 * whenever things change (a provider leaving drops its bindings). One choice among many; write your own for others.
 */
function firstProvider(system: SystemRuntime, id = 'binder'): Result<() => void> {
  let stopped = false
  const apply = () => {
    if (stopped) return
    const all = system.snapshot().instances
    const bound = new Set(system.bindings().map(b => `${b.from}\u0000${b.dependency}`))
    for (const i of all) for (const d of i.manifest.dependencies ?? []) {
      if (bound.has(`${i.id}\u0000${d.name}`)) continue
      const p = providerOf(d, all, i.id)
      if (p) void system.bind(i.id, d.name, p.instance, p.op.name) // a refused bind is retried on the next change
    }
  }
  const reg = system.register(id, policyComponent('binder', apply))
  if (reg.type !== 'success') return reg
  apply()
  return ok(() => { stopped = true; system.unregister(id) })
}

export const Binders = { firstProvider }
