// Edits: each applies the app's deployment with a pod or pipe added or removed; a refusal is shown, and returned.
import { AppDeployment, lookup } from '@pritzlaff/nano-core'
import type { Host } from '../host.ts'
import { jacksOfImpl, wireId, type Model } from './model'
import type { Catalog, Result } from './state'
import type { Wires } from './wires'

/** Applies the deployment `edit` makes of the live one; a refusal is shown, and returned. */
export async function change(el: Wires, edit: (d: AppDeployment) => AppDeployment | string, value?: unknown): Promise<Result> {
  const h = el.host
  if (!h) return { error: 'no host' }
  const next = edit(structuredClone(h.data()))
  const r = typeof next === 'string' ? { ok: false as const, fail: { reason: next } } : await h.apply(next)
  if (!r.ok) { el.fail(r.fail.reason); return { error: r.fail.reason } }
  return { value }
}
/** Builds a deployment with `edit` over core's AppDeployment.edit and applies it; a thrown fail or a refusal comes back as `{ error }`. */
async function patch(h: Host, edit: (e: ReturnType<typeof AppDeployment.edit>) => void): Promise<Result> {
  try {
    const e = AppDeployment.edit(h.data(), h.registry)
    edit(e)
    const r = await h.apply(e.deployment())
    return r.ok ? {} : { error: r.fail.reason }
  } catch (x) {
    const f = (x as { fail?: { reason: string } }).fail
    if (f) return { error: f.reason }
    throw x
  }
}
/** Adds a pipe from out jack `from` to in jack `to` (keys `pod port:dir`) in `runtime`, else in the first runtime (lookup
 * order) holding both pods. */
export async function connectPipe(h: Host, model: Model, from: string, to: string, runtime?: string): Promise<Result & { id?: string }> {
  const a = model.P[from]!, b = model.P[to]!, pipe = { from: a.owner, source: a.port, to: b.owner, target: b.port }
  const rt = runtime ?? [...lookup(h.data()).placed].find(([, pods]) => pods.has(a.owner) && pods.has(b.owner))?.[0]
  if (!rt) return { error: a.owner + ' and ' + b.owner + ' are not in one runtime' }
  const r = await patch(h, e => e.pipe(rt, pipe))
  return 'error' in r ? r : { value: { id: wireId(rt, pipe) } }
}
/** Removes the pipe a wire id (`runtime|from|to|target|source`) names. */
export function disconnectPipe(h: Host, id: string): Promise<Result> {
  const [rt, from, to, target, source] = id.split('|') as [string, string, string, string, string]
  return patch(h, e => e.unpipe(rt, { from, source, to, target }))
}
/** Removes a pod, from every runtime, with its pipes and edges. */
export function removeComponent(el: Wires, instance: string) {
  return change(el, d => {
    delete d.pods[instance]; delete d.views?.[instance]; delete d.tags?.[instance]
    for (const r of Object.values(d.runtimes)) { r.pods = r.pods.filter(p => p !== instance); r.subscriptions = r.subscriptions.filter(s => s.from !== instance && s.to !== instance) }
    return d
  })
}
/** Adds a lazy pod of `kind` (an implementation) to runtime main, under a fresh name; returns the name, or null if refused. */
export async function create(el: Wires, kind: string) {
  const r = el.host && await el.host.deploy(kind, 'main'), name = r && r.ok ? r.value : null
  if (!name) el.fail('Could not add a ' + kind)
  return name
}
/** Asks the workspace to open a rack component as a panel again: the dock's panel for that pod. */
export function openPanel(el: Wires, name: string) {
  const kind = el.kindOf(name)
  if (!kind) { el.fail(name + ' has no element to open'); return }
  el.dispatchEvent(new CustomEvent('wires:open-panel', { detail: { kind, name }, bubbles: true, composed: true }))
  el.ok('Opened ' + name + ' on the front')
}

/** What the host can make (the dock's palette), by implementation coordinate. */
export function catalogOf(h: Host | undefined): Catalog {
  if (!h) return {}
  return Object.fromEntries(h.registry.manifest().providers.filter(p => p.coord !== 'workspace.host').flatMap(p => p.implementations.map(c =>
    [c, { title: c.slice(c.indexOf('/') + 1), jacks: jacksOfImpl(h.registry.implementation(c)) }])))
}
