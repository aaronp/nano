/**
 * The application: a runtime of runtimes — children made, adopted, or started on demand from definitions that refer to
 * one pods table; tags shared. Starting makes each pod key once, application-wide, and registers it at its saved coord.
 *
 *   const app = createApplication('app', { registry })              // also its own root runtime
 *   app.define({ pods: { p0: { implementation: 'acme/keys/vault' } },
 *     runtimes: [{ id: 'keys', pods: [{ coord: 'acme/keys/vault#0', pod: 'p0' }], next: {}, subscriptions: [] }] })
 *   await app.start('keys')                                         // always a runtime; never provisions or starts another
 *   app.notes()                                                     // what starts skipped, e.g. a pod key not in the table
 */
import type { Policy } from './policy.ts'
import type { Registry } from './registry.ts'
import { failure, success, type NanoResult } from './result.ts'
import { createRuntime, ID, MAX_RUNTIMES, type Runtime } from './runtime/index.ts'
import { podsTable, type PodDef, type RuntimeDef } from './application-start.ts'

export { RuntimeDefSchema, type PodDef, type RuntimeDef } from './application-start.ts'

type Definition = { pods: Record<string, PodDef>; runtimes: RuntimeDef[] }

export type Application = Runtime & {
  /** A child runtime by id (the application's own id gives its root); defined but unstarted runtimes are undefined. */
  runtime(id: string): Runtime | undefined
  createRuntime(id: string, opts?: { policy?: Policy }): NanoResult<Runtime>
  adopt(child: Runtime): NanoResult<void>
  /**
   * Pods-table entries (keys not in the table) and runtimes (ids new; the root's own id too, while the root is empty,
   * so a document's root loads like any runtime), all or nothing.
   */
  define(d: Definition): NanoResult<void>
  /**
   * One runtime as data, in define's shape (`{ pods, runtimes: [it] }`: the pods entries it refers to). A started one
   * is from live, its pods keyed application-wide (a live pod gets a key on first ask); an unstarted one as defined.
   */
  definition(id: string): Definition | undefined
  /**
   * The runtime, started from its definition if need be: each entry registered at its saved coord, then the
   * subscriptions. What cannot be registered or subscribed is skipped with a note; a pod whose make fails is `failed`.
   * Fails only for an id neither started nor defined (`not-found`), or a throw while building (`threw`).
   */
  start(id: string): Promise<NanoResult<Runtime>>
  /** Child runtimes, started and defined (not the root). */
  runtimes(): readonly string[]
  /** What starts skipped, oldest first; each is also a `warning` on the root's stream as it happens. */
  notes(): readonly string[]
  /** Whether this child was adopted (adopted runtimes are not saved). */
  adopted(id: string): boolean
  tag(coord: string, tag: string): void
  untag(coord: string, tag: string): void
  tagsOf(coord: string): ReadonlySet<string>
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** `next`: the root's saved counters, so a coord is never reused after loading (as `RuntimeOpts.next`). */
export function createApplication(id: string, opts: { registry: Registry; policy?: Policy; next?: Record<string, number> }): Application {
  const tags = new Map<string, Set<string>>()
  const kids = new Map<string, Runtime>() // made, adopted and started children
  const defs = new Map<string, RuntimeDef>() // defined, not started yet (the root's too)
  const adopted = new Set<string>()
  const notes: string[] = [] // ponytail: unbounded; a cap or a drain when something long-lived reads it
  const all = (): Runtime[] => [root, ...kids.values()]
  const lookup = (rid: string) => (rid === id ? root : kids.get(rid))
  const taken = (rid: string) => (rid === id ? defs.has(id) || root.pods().length + root.subscriptions().length > 0 : kids.has(rid) || defs.has(rid))
  const saved = () => new Set([...kids.keys(), ...defs.keys()].filter(k => k !== id && !adopted.has(k))).size
  const noRoom = (more: number) => (saved() + more > MAX_RUNTIMES - 1
    ? failure('invalid-input', `the application would hold more than ${MAX_RUNTIMES - 1} runtimes besides its root`) : undefined)
  const tagsOf = (c: string): ReadonlySet<string> => tags.get(c) ?? new Set()
  /** A coord held nowhere is gone: its tags go too. */
  const watch = (r: Runtime) => r.listen(e => { if (e.type === 'pod-removed' && !all().some(o => o.pod(e.coord))) tags.delete(e.coord) })
  const note = (reason: string) => { notes.push(reason); root.warn(reason) }
  const child = (rid: string, o: { policy?: Policy; next?: Record<string, number> } = {}) => {
    const r = createRuntime(rid, { registry: opts.registry, tagsOf, ...o })
    kids.set(rid, r)
    watch(r)
    return r
  }
  const pods = podsTable(opts.registry, note)
  const root = createRuntime(id, { registry: opts.registry, tagsOf, ...(opts.policy && { policy: opts.policy }), ...(opts.next && { next: opts.next }) })
  watch(root)

  function start(rid: string): NanoResult<Runtime> {
    const def = defs.get(rid), have = lookup(rid)
    if (!def) return have ? success(have) : failure('not-found', `no runtime ${rid}`)
    const rt = have ?? child(rid, { next: def.next }) // the root's come with createApplication
    const added: string[] = []
    try {
      pods.fill(rt, def, added)
      defs.delete(rid)
      return success(rt)
    } catch (e) {
      for (const c of added) rt.unregister(c)
      if (rt !== root) kids.delete(rid)
      return failure('threw', `starting ${rid}: ${msg(e)}`)
    }
  }
  function definition(rid: string): Definition | undefined {
    const def = defs.get(rid), rt = lookup(rid)
    if (!def) return rt && pods.live(rt)
    const table = Object.fromEntries(def.pods.flatMap(({ pod }) => { const d = pods.entry(pod); return d ? [[pod, d]] : [] }))
    return { pods: table, runtimes: [{ ...structuredClone(def), policy: 'allow-all' }] } // a definition starts allow-all
  }

  return {
    ...root,
    runtime: lookup,
    createRuntime(rid, o = {}) {
      if (!ID.test(rid)) return failure('invalid-input', `bad runtime id ${JSON.stringify(rid)}`)
      if (rid === id || taken(rid)) return failure('exists', `runtime ${rid} exists`)
      return noRoom(1) ?? success(child(rid, o))
    },
    adopt(c) {
      if (c.id === id || taken(c.id)) return failure('exists', `runtime ${c.id} exists`)
      kids.set(c.id, c)
      adopted.add(c.id)
      watch(c)
      return success(undefined)
    },
    define(d) {
      const bad = pods.check(d)
      if (bad) return bad
      const ids = d.runtimes.map(r => r.id), twice = ids.find((r, n) => ids.indexOf(r) !== n || taken(r))
      if (twice !== undefined) return failure('exists', `runtime ${twice} exists`)
      const room = noRoom(ids.filter(r => r !== id).length)
      if (room) return room
      pods.add(d.pods)
      for (const r of d.runtimes) defs.set(r.id, structuredClone(r)) // its own copy, as the table keeps
      return success(undefined)
    },
    definition,
    start: async rid => start(rid),
    runtimes: () => [...new Set([...kids.keys(), ...defs.keys()])].filter(r => r !== id),
    notes: () => [...notes],
    adopted: rid => adopted.has(rid),
    tag(c, t) { tags.set(c, (tags.get(c) ?? new Set()).add(t)) },
    untag(c, t) { tags.get(c)?.delete(t) },
    tagsOf,
  }
}
