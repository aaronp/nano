/**
 * The `nano.json` v2 document: every runtime of an application saved as data (opened or not), checked, loaded and opened on demand.
 *
 *   const doc = saveDoc(app, { title: 'Signer' })                // plain JSON data
 *   checkDoc(JSON.parse(text))                                    // a NanoDoc, or the reason it is not one
 *   const { app, notes } = await loadDoc(doc, { registry })       // never throws; what could not load is in `notes`
 */
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'
import { createApplication, type Application, type RuntimeDef } from './application.ts'
import { COORD } from './iface.ts'
import { Policies, type Policy } from './policy.ts'
import type { Registry } from './registry.ts'
import type { NanoResult } from './result.ts'
import { instanceCoord, invalid, parseInstance, type Runtime } from './runtime/index.ts'

export type { RuntimeDef } from './application.ts'

const ID = '[^/\\s#\\x00-\\x1f\\x7f]{1,64}'
const Id = Type.String({ pattern: `^${ID}$` })
const Impl = Type.String({ pattern: COORD.source })
const Instance = Type.String({ pattern: `^${COORD.source.slice(1, -1)}#${ID}$` })
const Port = Type.String({ minLength: 1 })

const RuntimeDefSchema = Type.Object({
  id: Id,
  policy: Type.Optional(Type.Literal('allow-all')),
  instances: Type.Array(Type.Object({ id: Id, implementation: Impl, config: Type.Optional(Type.Unknown()) }), { maxItems: 500 }),
  members: Type.Array(Type.Object({ instance: Instance, home: Id }), { maxItems: 500 }),
  subscriptions: Type.Array(Type.Union([
    Type.Object({ id: Id, kind: Type.Literal('call'), from: Instance, to: Instance }),
    Type.Object({ id: Id, kind: Type.Literal('event'), from: Instance, source: Port, to: Instance, target: Port }),
  ]), { maxItems: 2000 }),
})

export const NanoDocSchema = Type.Object({
  nano: Type.Literal(2),
  title: Type.String(),
  providers: Type.Array(Type.String()),
  runtimes: Type.Array(RuntimeDefSchema, { maxItems: 50 }),
  tags: Type.Record(Type.String(), Type.Array(Type.String())),
  /** Runtimes to open on load. */
  open: Type.Optional(Type.Array(Id)),
  /** Opaque until the host defines it. */
  workspaces: Type.Optional(Type.Array(Type.Unknown())),
})

export type NanoDoc = Static<typeof NanoDocSchema>

/** The document, or why it is not a v2 document (`<path>: <message>` for the first error). Never throws. */
export function checkDoc(json: unknown): NanoDoc | string {
  if (json === null || typeof json !== 'object' || (json as { nano?: unknown }).nano !== 2) return 'not a nano v2 document'
  try {
    const e = Value.Errors(NanoDocSchema, json)[0]
    return e ? `${e.instancePath || '/'}: ${e.message}` : (json as NanoDoc)
  } catch (e) {
    return `unreadable document: ${e instanceof Error ? e.message : String(e)}`
  }
}

/** An opened runtime as data: its own instances (create order, config if given), members placed in with their home, subscriptions in order. */
function live(rt: Runtime): RuntimeDef {
  const def: RuntimeDef = {
    id: rt.id,
    ...(rt.policy === Policies.allowAll() && { policy: 'allow-all' as const }),
    instances: [], members: [], subscriptions: rt.subscriptions().map(s => ({ ...s })),
  }
  for (const c of rt.members()) {
    const m = rt.member(c)!
    if (m.home !== rt.id) def.members.push({ instance: c, home: m.home })
    else def.instances.push({ id: parseInstance(c)!.id, implementation: m.pod.implementation.coord, ...(m.config !== undefined && { config: m.config }) })
  }
  return def
}

/**
 * Every runtime but adopted ones: opened ones from live, the rest as defined. The root is saved under the
 * application's id when it holds members or subscriptions. A custom policy is not saved (allow-all is the only one).
 */
export function saveDoc(app: Application, opts: { title?: string; workspaces?: unknown[] } = {}): NanoDoc {
  const root = live(app.runtime(app.id)!)
  const withRoot = root.instances.length + root.members.length + root.subscriptions.length > 0
  const ids = app.runtimes().filter(id => !app.adopted(id))
  const runtimes = [
    ...(withRoot ? [root] : []),
    ...ids.map(id => { const rt = app.runtime(id); return rt ? live(rt) : structuredClone(app.definition(id)!) }),
  ]
  const coords = runtimes.flatMap(r => [...r.instances.map(i => instanceCoord(i.implementation, i.id)), ...r.members.map(m => m.instance)])
  const tags: Record<string, string[]> = {}
  for (const c of coords) { const t = app.tagsOf(c); if (t.size) tags[c] = [...t] }
  const providers = new Set(runtimes.flatMap(r => r.instances.flatMap(i => app.registry.implementation(i.implementation)?.provider ?? [])))
  return {
    nano: 2,
    title: opts.title ?? app.id,
    providers: [...providers].sort(),
    runtimes,
    tags,
    open: [...(withRoot ? [app.id] : []), ...ids.filter(id => app.runtime(id))],
    ...(opts.workspaces && { workspaces: opts.workspaces }),
  }
}

/**
 * Define every runtime, build the root's own (if saved under this application's id, default `app`), then open those
 * in `open`. What cannot load is skipped with a note; the rest loads. Never throws; an invalid document gives an empty application.
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
    // Instances first, everywhere, so a member can be checked against what its home will really hold.
    const withImpl = checked.runtimes.map(d => ({
      ...d,
      instances: d.instances.filter(i => registry.implementation(i.implementation) || !notes.push(`${d.id}/${i.id}: no implementation ${i.implementation}`)),
    }))
    const defs: RuntimeDef[] = withImpl.map(d => {
      const seen = new Set<string>()
      return {
        ...d,
        members: d.members.filter(m => {
          const home = m.home !== d.id && withImpl.find(h => h.id === m.home)
          return (home && home.instances.some(i => instanceCoord(i.implementation, i.id) === m.instance)) ||
            !notes.push(`${d.id}: member ${m.instance} has no home ${m.home}`)
        }),
        subscriptions: d.subscriptions.filter(s => {
          const why = invalid(s) ?? (seen.has(s.id) ? `subscription ${s.id} exists` : undefined)
          seen.add(s.id)
          return !why || !notes.push(`${d.id}/${s.id}: ${why}`)
        }),
      }
    })
    const root = defs.find(d => d.id === app.id)
    const defined = new Set(defs.filter(d => d !== root && note(d.id, app.define(d))).map(d => d.id))
    for (const [c, ts] of Object.entries(checked.tags)) for (const t of ts) app.tag(c, t)
    if (root) {
      for (const i of root.instances)
        note(`${app.id}/${i.id}`, await app.create(i.id, i.implementation, { ...(i.config !== undefined && { config: i.config }), provision: false }))
      for (const m of root.members) {
        const home = await app.open(m.home)
        note(app.id, home.ok ? app.place(m.instance, m.home, app.id) : home)
      }
      for (const s of root.subscriptions) note(`${app.id}/${s.id}`, app.subscribe(s))
    }
    for (const id of checked.open ?? []) if (id !== app.id && (defined.has(id) || !defs.some(d => d.id === id))) note(id, await app.open(id))
  } catch (e) {
    notes.push(`load: ${e instanceof Error ? e.message : String(e)}`)
  }
  return { app, notes }
}
