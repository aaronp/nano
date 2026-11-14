/**
 * The `nano.json` v2 document: one pods table, and every runtime of an application (started or not) referring to it by
 * key; checked, loaded and started on demand. A pod in several runtimes is one entry; loading makes it once.
 *
 *   const doc = saveDoc(app, { title: 'Signer' })                // plain JSON data
 *   checkDoc(JSON.parse(text))                                    // a NanoDoc, or the reason it is not one
 *   const { app, notes } = await loadDoc(doc, { registry })       // never throws; what could not load is in `notes`
 */
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'
import { createApplication, RuntimeDefSchema, type Application, type PodDef } from './application.ts'
import { COORD } from './iface.ts'
import type { Policy } from './policy.ts'
import type { Registry } from './registry.ts'
import type { NanoResult } from './result.ts'
import { ID, MAX_RUNTIMES } from './runtime/index.ts'

export type { RuntimeDef } from './application.ts'

/** Pods in a document, at most: a bound on what loading one file can make. */
const MAX_DOC_PODS = 5000

export const NanoDocSchema = Type.Object({
  nano: Type.Literal(2),
  title: Type.String(),
  providers: Type.Array(Type.String()),
  /** Each pod once, by key (`p0`, `p1`, …): its implementation and config. */
  pods: Type.Record(Type.String({ pattern: ID.source }), Type.Object({ implementation: Type.String({ pattern: COORD.source }), config: Type.Optional(Type.Unknown()) }), { additionalProperties: false }),
  runtimes: Type.Array(RuntimeDefSchema, { maxItems: MAX_RUNTIMES }),
  tags: Type.Record(Type.String(), Type.Array(Type.String())),
  /** Runtimes to start on load. */
  start: Type.Optional(Type.Array(Type.String({ pattern: ID.source }))),
  /** Opaque until the host defines it. */
  workspaces: Type.Optional(Type.Array(Type.Unknown())),
})

export type NanoDoc = Static<typeof NanoDocSchema>

/** The document, or why it is not a v2 document (`<path>: <message>` for the first error). Never throws. */
export function checkDoc(json: unknown): NanoDoc | string {
  if (json === null || typeof json !== 'object' || (json as { nano?: unknown }).nano !== 2) return 'not a nano v2 document'
  try {
    const e = Value.Errors(NanoDocSchema, json)[0]
    if (e) return `${e.instancePath || '/'}: ${e.message}`
    const doc = json as NanoDoc, n = Object.keys(doc.pods).length
    return n > MAX_DOC_PODS ? `${n} pods (at most ${MAX_DOC_PODS} in a document)` : doc
  } catch (e) {
    return `unreadable document: ${e instanceof Error ? e.message : String(e)}`
  }
}

/**
 * The root (when it holds pods or subscriptions) and every child but adopted ones, started ones from live, the rest as
 * defined; pods keyed `p0`, `p1`, … in first-registered order, one entry per pod however many runtimes refer to it.
 */
function saved(app: Application) {
  const ids = app.runtimes().filter(id => !app.adopted(id))
  const rootDef = app.definition(app.id)!, root = rootDef.runtimes[0]!
  const withRoot = root.pods.length + root.subscriptions.length > 0
  const keys = new Map<string, string>(), pods: Record<string, PodDef> = {}
  const runtimes = [...(withRoot ? [rootDef] : []), ...ids.map(id => app.definition(id)!)].map(d => ({
    ...d.runtimes[0]!,
    pods: d.runtimes[0]!.pods.flatMap(({ coord, pod }) => {
      const entry = d.pods[pod]
      if (!entry) return [] // a key that was never in the table: starting skips it anyway
      let k = keys.get(pod)
      if (k === undefined) { k = `p${keys.size}`; keys.set(pod, k); pods[k] = entry }
      return [{ coord, pod: k }]
    }),
  }))
  return { pods, runtimes, withRoot, ids }
}

export function saveDoc(app: Application, opts: { title?: string; workspaces?: unknown[] } = {}): NanoDoc {
  const { pods, runtimes, withRoot, ids } = saved(app)
  const tags: Record<string, string[]> = {}
  for (const c of new Set(runtimes.flatMap(r => r.pods.map(p => p.coord)))) { const t = app.tagsOf(c); if (t.size) tags[c] = [...t] }
  const providers = new Set(Object.values(pods).map(p => p.implementation.slice(0, p.implementation.lastIndexOf('/'))))
  return {
    nano: 2,
    title: opts.title ?? app.id,
    providers: [...providers].sort(),
    pods,
    runtimes,
    tags,
    start: [...(withRoot ? [app.id] : []), ...ids.filter(id => app.runtime(id))],
    ...(opts.workspaces && { workspaces: opts.workspaces }),
  }
}

/**
 * Define the pods table and every runtime (the root's under this application's id, default `app`), start the root,
 * then those in `start`. What cannot load is skipped with a note; the rest loads. Never throws; an invalid document
 * gives an empty application.
 */
export async function loadDoc(doc: NanoDoc, opts: { registry: Registry; policy?: Policy; id?: string }): Promise<{ app: Application; notes: string[] }> {
  const { registry } = opts
  const app = createApplication(opts.id ?? 'app', { registry, ...(opts.policy && { policy: opts.policy }) })
  const notes: string[] = []
  const checked = checkDoc(doc)
  if (typeof checked === 'string') return { app, notes: [checked] }
  const note = (where: string, r: NanoResult<unknown>) => { if (!r.ok) notes.push(`${where}: ${r.fail.reason}`); return r.ok }
  try {
    for (const p of checked.providers) if (!registry.provider(p)) notes.push(`provider ${p} is not registered`)
    // No policy saved means a custom one; only allow-all can be loaded (the root takes `opts.policy` when given).
    for (const d of checked.runtimes)
      if (!d.policy && !(d.id === app.id && opts.policy)) notes.push(`${d.id}: saved with a custom policy; loaded with allow-all`)
    note('pods', app.define({ pods: checked.pods, runtimes: [] }))
    const defined = new Set(checked.runtimes.filter(d => note(d.id, app.define({ pods: {}, runtimes: [d] }))).map(d => d.id))
    const known = new Set(checked.runtimes.map(d => d.id))
    for (const id of new Set([...(defined.has(app.id) ? [app.id] : []), ...(checked.start ?? [])]))
      if (defined.has(id) || !known.has(id)) note(id, await app.start(id))
    // Tags only for what the runtimes refer to now: a dropped pod's tags would attach to whatever later takes its coord.
    const held = new Set(saved(app).runtimes.flatMap(r => r.pods.map(p => p.coord)))
    for (const [c, ts] of Object.entries(checked.tags)) if (held.has(c)) for (const t of ts) app.tag(c, t)
  } catch (e) {
    notes.push(`load: ${e instanceof Error ? e.message : String(e)}`)
  }
  notes.push(...app.notes()) // what the starts skipped
  return { app, notes }
}
