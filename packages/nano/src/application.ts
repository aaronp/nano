/**
 * The application: a runtime of runtimes — children made, adopted, or started on demand from definitions; pods placed across them; tags and pod ids shared.
 *
 *   const app = createApplication('app', { registry })              // also its own root runtime
 *   app.define({ id: 'client', pods: [{ id: 't', implementation: 'acme/ui/tester', instances: [0], next: 1 }], members: [{ pod: 's', home: 'signer' }], subscriptions: [] })
 *   await app.start('client')                                       // starts the runtimes its members come from, then builds it; always a runtime
 *   app.place('s', 'signer', 'client')                               // pod s is a member of both; it still calls out through `signer`
 *   app.notes()                                                     // what it skipped, e.g. a pod that could not be made or a member whose home failed to start
 */
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { COORD } from './iface.ts'
import type { Policy } from './policy.ts'
import type { Registry } from './registry.ts'
import { failure, success, type NanoResult } from './result.ts'
import { badIndices, createRuntime, ID, parseInstance, type Runtime, type SubscriptionData } from './runtime/index.ts'
import { isJson } from './schema.ts'

const inner = (r: RegExp) => r.source.slice(1, -1) // COORD and ID are anchored `^…$` and flagless, so their bodies compose
const Id = Type.String({ pattern: ID.source })
const Instance = Type.String({ pattern: `^${inner(ID)}#(0|[1-9][0-9]{0,8})$` })
const Port = Type.String({ minLength: 1 })
const Index = Type.Integer({ minimum: 0, maximum: 999_999_999 })

/** What a `RuntimeDef` must be: `define` checks it, and the document holds runtimes of this shape. */
export const RuntimeDefSchema = Type.Object({
  id: Id,
  policy: Type.Optional(Type.Literal('allow-all')),
  pods: Type.Array(Type.Object({
    id: Id,
    implementation: Type.String({ pattern: COORD.source }),
    config: Type.Optional(Type.Unknown()),
    instances: Type.Array(Index, { maxItems: 500 }),
    next: Type.Integer({ minimum: 0, maximum: 1e9 }),
  }), { maxItems: 500 }),
  members: Type.Array(Type.Object({ pod: Id, home: Id }), { maxItems: 500 }),
  subscriptions: Type.Array(Type.Union([
    Type.Object({ id: Id, kind: Type.Literal('call'), from: Instance, to: Instance }),
    Type.Object({ id: Id, kind: Type.Literal('event'), from: Instance, source: Port, to: Instance, target: Port }),
  ]), { maxItems: 2000 }),
})

/**
 * A runtime as saved: its own pods (create order) with their live instance indices and `next` (so an index is never
 * reused across a save), the pods placed into it with their home, and its subscriptions (in order).
 */
export type RuntimeDef = {
  id: string
  policy?: 'allow-all'
  pods: { id: string; implementation: string; config?: unknown; instances: number[]; next: number }[]
  members: { pod: string; home: string }[]
  subscriptions: SubscriptionData[]
}

export type Application = Runtime & {
  /** A child runtime by id (the application's own id gives its root); defined but unstarted runtimes are undefined. */
  runtime(id: string): Runtime | undefined
  createRuntime(id: string, opts?: { policy?: Policy }): NanoResult<Runtime>
  adopt(child: Runtime): NanoResult<void>
  define(def: RuntimeDef): NanoResult<void>
  definition(id: string): RuntimeDef | undefined
  /**
   * The runtime, started from its definition if need be. Starting always gives a runtime, whatever its pods do: a pod
   * whose make fails is `failed`, and what cannot be made, placed or subscribed is skipped with a note. Fails only for
   * an id neither started nor defined (`not-found`), or a throw while building (`threw`).
   */
  start(id: string): Promise<NanoResult<Runtime>>
  /** Place pod `pod` from runtime `from` into `to` (its policy asked with the pod id): the same record, not a copy. */
  place(pod: string, from: string, to: string): NanoResult<void>
  /** Child runtimes, started and defined (not the root). */
  runtimes(): readonly string[]
  /** What the application skipped or could not follow, oldest first: pods, members and subscriptions a start skipped. */
  notes(): readonly string[]
  /** Whether this child was adopted (adopted runtimes are not saved). */
  adopted(id: string): boolean
  tag(coord: string, tag: string): void
  untag(coord: string, tag: string): void
  tagsOf(coord: string): ReadonlySet<string>
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createApplication(id: string, opts: { registry: Registry; policy?: Policy }): Application {
  const tags = new Map<string, Set<string>>()
  const kids = new Map<string, Runtime>() // made, adopted and started children
  const defs = new Map<string, RuntimeDef>()
  const adopted = new Set<string>()
  const notes: string[] = [] // ponytail: unbounded; a cap or a drain when something long-lived reads it
  /** Starts in progress: `made` once its own pods exist (or it failed), `done` when it is started or failed. */
  const starting = new Map<string, { made: Promise<void>; done: Promise<NanoResult<Runtime>> }>()
  const all = (): Runtime[] => [root, ...kids.values()]
  const lookup = (rid: string) => (rid === id ? root : kids.get(rid))
  const taken = (rid: string) => rid === id || kids.has(rid) || defs.has(rid)

  const tagsOf = (c: string): ReadonlySet<string> => tags.get(c) ?? new Set()
  // Pod ids are unique across the application: held in any runtime, or declared by a runtime not started yet.
  const idTaken = (pid: string) =>
    all().some(r => r.pod(pid)) || [...defs.values()].some(d => !kids.has(d.id) && d.pods.some(p => p.id === pid))
  // Pod ids are unique, so only the home runtime can have a pass for a coord.
  const settling = (c: string) => { for (const r of all()) { const p = r.settling(c); if (p) return p } }
  const shared = { registry: opts.registry, tagsOf, idTaken, settling }

  /**
   * A pod removed at its home is removed wherever it was placed. (A swap needs nothing here: the placed pod is
   * the home's record, so every runtime holding it sees the new implementation.)
   */
  const watch = (r: Runtime) => r.listen(e => {
    if (e.type !== 'instance-removed') return
    const pid = parseInstance(e.instance)!.pod
    if (!r.pod(pid)) for (const o of all()) if (o !== r && o.pod(pid)?.home === r.id) o.remove(pid)
    if (!all().some(o => o.instances().includes(e.instance))) tags.delete(e.instance)
  })
  const child = (rid: string, policy?: Policy) => {
    const r = createRuntime(rid, { ...shared, ...(policy && { policy }) })
    kids.set(rid, r)
    watch(r)
    return r
  }
  const root = createRuntime(id, { ...shared, ...(opts.policy && { policy: opts.policy }) })
  watch(root)

  /** Places a pod, with all its instances. */
  function place(pod: string, from: string, to: string): NanoResult<void> {
    const rec = lookup(from)?.record(pod)
    if (!rec) return failure('not-found', `${pod} is not in ${from}`)
    const dst = lookup(to)
    if (!dst) return failure('not-found', `no runtime ${to}`)
    let v
    try { v = dst.policy.isAllowed(from, to, pod) } catch (e) { return failure('denied', `policy threw: ${msg(e)}`) }
    if (!v.approved) return failure('denied', v.reason)
    return dst.add(rec)
  }

  /**
   * Its own pods first (unprovisioned, at their saved indices), then the runtimes its members come from, then its
   * members, then its subscriptions (they may wait). A home on this start's own chain is skipped (it made its pods
   * already); a home another start is building is waited for only until its pods exist (waiting for all of it could
   * deadlock two overlapping starts); any other home is started, in full. A pod that cannot be made, a member whose
   * home fails to start or that cannot be placed, and a subscription that cannot be added are each skipped with a
   * note. Only a throw takes the runtime down again (runtimes started on the way stay).
   */
  async function build(def: RuntimeDef, chain: ReadonlySet<string>, made: () => void): Promise<NanoResult<Runtime>> {
    const rt = child(def.id) // 'allow-all' is the only saved policy, and the default
    const skip = (what: string, r: NanoResult<unknown>) => { if (!r.ok) notes.push(`${what}: ${r.fail.reason}`) }
    try {
      for (const p of def.pods)
        skip(`${def.id}/${p.id}`, await rt.create(p.id, p.implementation, { ...(p.config !== undefined && { config: p.config }), instances: p.instances, next: p.next, provision: false }))
      made()
      const failed = new Map<string, string>() // home → why it did not start
      for (const home of new Set(def.members.map(m => m.home))) {
        if (chain.has(home)) continue
        const other = starting.get(home)
        if (other) { await other.made; continue }
        const r = await start(home, chain)
        if (!r.ok) failed.set(home, r.fail.reason)
      }
      for (const m of def.members) {
        const why = failed.get(m.home) ?? (r => (r.ok ? undefined : r.fail.reason))(place(m.pod, m.home, def.id))
        if (why) notes.push(`${def.id}: member ${m.pod} skipped: ${why}`)
      }
      for (const s of def.subscriptions) skip(`${def.id}/${s.id}`, rt.subscribe(s))
      return success(rt)
    } catch (e) {
      for (const p of rt.pods()) rt.remove(p)
      kids.delete(def.id)
      return failure('threw', `starting ${def.id}: ${msg(e)}`)
    }
  }

  function start(rid: string, chain: ReadonlySet<string> = new Set()): Promise<NanoResult<Runtime>> {
    const pending = starting.get(rid)
    if (pending) return pending.done
    const have = lookup(rid)
    if (have) return Promise.resolve(success(have))
    const def = defs.get(rid)
    if (!def) return Promise.resolve(failure('not-found', `no runtime ${rid}`))
    let made!: () => void
    const m = new Promise<void>(res => { made = res })
    // Registered before the build starts, so every start from here on sees it in progress.
    const done = Promise.resolve()
      .then(() => build(def, new Set(chain).add(rid), made))
      .finally(() => { made(); starting.delete(rid) })
    starting.set(rid, { made: m, done })
    return done
  }

  return {
    ...root,
    runtime: lookup,
    createRuntime(rid, o = {}) {
      if (!ID.test(rid)) return failure('invalid-input', `bad runtime id ${JSON.stringify(rid)}`)
      if (taken(rid)) return failure('exists', `runtime ${rid} exists`)
      return success(child(rid, o.policy))
    },
    adopt(c) {
      if (taken(c.id)) return failure('exists', `runtime ${c.id} exists`)
      kids.set(c.id, c)
      adopted.add(c.id)
      watch(c)
      return success(undefined)
    },
    define(def) {
      const e = Value.Errors(RuntimeDefSchema, def)[0]
      if (e) return failure('invalid-input', `bad runtime definition: ${e.instancePath || '/'}: ${e.message}`)
      for (const p of def.pods) {
        if (p.config !== undefined && !isJson(p.config)) return failure('invalid-input', `${p.id}: config is not JSON`)
        const why = badIndices(p.instances, p.next)
        if (why) return failure('invalid-input', `${p.id}: ${why}`)
      }
      if (taken(def.id)) return failure('exists', `runtime ${def.id} exists`)
      const twice = def.pods.find((p, n) => def.pods.findIndex(q => q.id === p.id) !== n)
      if (twice) return failure('exists', `pod id ${twice.id} is repeated`)
      const clash = def.pods.find(p => idTaken(p.id))
      if (clash) return failure('exists', `pod id ${clash.id} is taken`)
      defs.set(def.id, structuredClone(def)) // its own copy: a later edit to `def` never changes what starts
      return success(undefined)
    },
    definition: rid => { const d = defs.get(rid); return d && structuredClone(d) },
    start: rid => start(rid),
    place,
    runtimes: () => [...new Set([...kids.keys(), ...defs.keys()])],
    notes: () => [...notes],
    adopted: rid => adopted.has(rid),
    tag(c, t) { tags.set(c, (tags.get(c) ?? new Set()).add(t)) },
    untag(c, t) { tags.get(c)?.delete(t) },
    tagsOf,
  }
}
