// Edits: each applies the app's deployment with a pod or pipe added or removed; a refusal is shown, and returned.
import type { AppDeployment } from '@pritzlaff/nano-core'
import { addPod } from '../dock/panels.ts'
import type { Host } from '../host.ts'
import { jacksOfImpl, wireId } from './model'
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
/** Adds a pipe from an out jack to an in jack, in a runtime both pods are placed in; its value is `{ id }`. */
export function connect(el: Wires, from: string, to: string) {
  const a = el.model.P[from]!, b = el.model.P[to]!, pipe = { kind: 'pipe' as const, from: a.owner, source: a.port, to: b.owner, target: b.port }
  const rt = Object.keys(el.host?.data().runtimes ?? {}).find(r => [a.owner, b.owner].every(p => el.host!.data().runtimes[r]!.pods.includes(p)))
  return change(el, d => rt ? (d.runtimes[rt]!.subscriptions.push(pipe), d) : a.owner + ' and ' + b.owner + ' are not in one runtime', rt && { id: wireId(rt, pipe) })
}
/** Removes the pipe a wire id names. */
export function disconnect(el: Wires, id: string) {
  const [rt, from, to, target, source] = id.split('|')
  return change(el, d => {
    const r = d.runtimes[rt!]
    if (r) r.subscriptions = r.subscriptions.filter(s => !(s.kind === 'pipe' && s.from === from && s.to === to && s.target === target && s.source === source))
    return d
  })
}
/** Removes a pod, from every runtime, with its pipes and edges. */
export function removeComponent(el: Wires, instance: string) {
  return change(el, d => {
    delete d.pods[instance]; delete d.views?.[instance]; delete d.tags?.[instance]
    for (const r of Object.values(d.runtimes)) { r.pods = r.pods.filter(p => p !== instance); r.subscriptions = r.subscriptions.filter(s => s.from !== instance && s.to !== instance) }
    return d
  })
}
/** Adds a pod of `kind` (an implementation) to runtime main, under a fresh name; returns the name, or null if refused. */
export async function create(el: Wires, kind: string) {
  const name = el.host && await addPod(el.host, kind)
  if (!name) el.fail('Could not add a ' + kind)
  return name ?? null
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
