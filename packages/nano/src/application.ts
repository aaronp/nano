/**
 * The application: a runtime of runtimes — children made, adopted, or opened on demand from definitions; instances placed across them; tags and instance ids shared.
 *
 *   const app = createApplication('app', { registry })              // also its own root runtime
 *   app.define(clientDef)                                           // data only, until something needs it
 *   await app.open('client')                                        // opens the runtimes its members come from, then builds it
 *   app.place('acme/keys/signer#s', 'signer', 'client')             // a member of both; it still calls out through `signer`
 */
import type { Policy } from './policy.ts'
import type { Registry } from './registry.ts'
import { failure, success, type NanoResult } from './result.ts'
import { createRuntime, parseInstance, type Runtime, type SubscriptionData } from './runtime/index.ts'

/** A runtime as saved: its own instances (create order), the members placed into it, and its subscriptions (in order). */
export type RuntimeDef = {
  id: string
  policy?: 'allow-all'
  instances: { id: string; implementation: string; config?: unknown }[]
  members: { instance: string; home: string }[]
  subscriptions: SubscriptionData[]
}

export type Application = Runtime & {
  /** A child runtime by id (the application's own id gives its root); defined but unopened runtimes are undefined. */
  runtime(id: string): Runtime | undefined
  createRuntime(id: string, opts?: { policy?: Policy }): NanoResult<Runtime>
  adopt(child: Runtime): NanoResult<void>
  define(def: RuntimeDef): NanoResult<void>
  definition(id: string): RuntimeDef | undefined
  open(id: string): Promise<NanoResult<Runtime>>
  place(instance: string, from: string, to: string): NanoResult<void>
  /** Child runtimes, opened and defined (not the root). */
  runtimes(): readonly string[]
  tag(coord: string, tag: string): void
  untag(coord: string, tag: string): void
  tagsOf(coord: string): ReadonlySet<string>
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function createApplication(id: string, opts: { registry: Registry; policy?: Policy }): Application {
  const tags = new Map<string, Set<string>>()
  const kids = new Map<string, Runtime>() // made, adopted and opened children
  const defs = new Map<string, RuntimeDef>()
  /** Opens in progress: `made` once its own instances exist (or it failed), `done` when it is open or failed. */
  const opening = new Map<string, { made: Promise<void>; done: Promise<NanoResult<Runtime>> }>()
  const all = (): Runtime[] => [root, ...kids.values()]
  const lookup = (rid: string) => (rid === id ? root : kids.get(rid))
  const taken = (rid: string) => rid === id || kids.has(rid) || defs.has(rid)

  const tagsOf = (c: string): ReadonlySet<string> => tags.get(c) ?? new Set()
  // Unique across the application: held in any runtime, or declared by a runtime not opened yet.
  const idTaken = (iid: string) =>
    all().some(r => r.members().some(c => parseInstance(c)?.id === iid)) ||
    [...defs.values()].some(d => !kids.has(d.id) && d.instances.some(i => i.id === iid))
  // Instance ids are unique, so only the home runtime can have a pass for a coord.
  const settling = (c: string) => { for (const r of all()) { const p = r.settling(c); if (p) return p } }
  const shared = { registry: opts.registry, tagsOf, idTaken, settling }

  /** What happens to an instance at its home happens wherever it was placed: removal, and replacement. */
  const watch = (r: Runtime) => r.listen(e => {
    if (e.type === 'instance-removed') {
      for (const o of all()) if (o !== r && o.member(e.instance)?.home === r.id) o.remove(e.instance)
      if (!all().some(o => o.member(e.instance))) tags.delete(e.instance)
    }
    if (e.type === 'instance-replaced') {
      const next = r.member(e.to)
      if (next?.home !== r.id) return
      // A guest whose policy denies the rewrite keeps its subscriptions on the old coord, waiting (decision 34).
      for (const o of all()) if (o !== r && o.member(e.from)?.home === r.id) o.rehome(e.from, next)
      const t = tags.get(e.from)
      if (t) { tags.delete(e.from); tags.set(e.to, t) }
    }
  })
  const child = (rid: string, policy?: Policy) => {
    const r = createRuntime(rid, { ...shared, ...(policy && { policy }) })
    kids.set(rid, r)
    watch(r)
    return r
  }
  const root = createRuntime(id, { ...shared, ...(opts.policy && { policy: opts.policy }) })
  watch(root)

  function place(instance: string, from: string, to: string): NanoResult<void> {
    const m = lookup(from)?.member(instance)
    if (!m) return failure('not-found', `${instance} is not a member of ${from}`)
    const dst = lookup(to)
    if (!dst) return failure('not-found', `no runtime ${to}`)
    let v
    try { v = dst.policy.isAllowed(from, to, instance) } catch (e) { return failure('denied', `policy threw: ${msg(e)}`) }
    if (!v.approved) return failure('denied', v.reason)
    return dst.add({ coord: m.coord, pod: m.pod, home: m.home })
  }

  /**
   * Its own instances first (unprovisioned), then the runtimes its members come from, then its members, then its
   * subscriptions (they may wait). A home on this open's own chain is skipped (it made its instances already); a home
   * another open is building is waited for only until its instances exist (waiting for all of it could deadlock two
   * overlapping opens); any other home is opened, in full. On a failure the runtime is taken down again; runtimes
   * opened on the way stay open.
   */
  async function build(def: RuntimeDef, chain: ReadonlySet<string>, made: () => void): Promise<NanoResult<Runtime>> {
    const rt = child(def.id) // 'allow-all' is the only saved policy, and the default
    const undo = (r: NanoResult<never>): NanoResult<Runtime> => {
      for (const c of rt.members()) rt.remove(c)
      kids.delete(def.id)
      return r
    }
    try {
      for (const i of def.instances) {
        const r = await rt.create(i.id, i.implementation, { ...(i.config !== undefined && { config: i.config }), provision: false })
        if (!r.ok) return undo(r)
      }
      made()
      for (const home of new Set(def.members.map(m => m.home))) {
        if (chain.has(home)) continue
        const other = opening.get(home)
        if (other) { await other.made; continue }
        const r = await open(home, chain)
        if (!r.ok) return undo(r)
      }
      for (const m of def.members) { const r = place(m.instance, m.home, def.id); if (!r.ok) return undo(r) }
      for (const s of def.subscriptions) { const r = rt.subscribe(s); if (!r.ok) return undo(r) }
      return success(rt)
    } catch (e) {
      return undo(failure('threw', `opening ${def.id}: ${msg(e)}`))
    }
  }

  function open(rid: string, chain: ReadonlySet<string> = new Set()): Promise<NanoResult<Runtime>> {
    const pending = opening.get(rid)
    if (pending) return pending.done
    const have = lookup(rid)
    if (have) return Promise.resolve(success(have))
    const def = defs.get(rid)
    if (!def) return Promise.resolve(failure('not-found', `no runtime ${rid}`))
    let made!: () => void
    const m = new Promise<void>(res => { made = res })
    // Registered before the build starts, so every open from here on sees it in progress.
    const done = Promise.resolve()
      .then(() => build(def, new Set(chain).add(rid), made))
      .finally(() => { made(); opening.delete(rid) })
    opening.set(rid, { made: m, done })
    return done
  }

  return {
    ...root,
    runtime: lookup,
    createRuntime(rid, o = {}) {
      if (taken(rid)) return failure('exists', `runtime ${rid} exists`)
      return success(child(rid, o.policy))
    },
    adopt(c) {
      if (taken(c.id)) return failure('exists', `runtime ${c.id} exists`)
      kids.set(c.id, c)
      watch(c)
      return success(undefined)
    },
    define(def) {
      if (taken(def.id)) return failure('exists', `runtime ${def.id} exists`)
      const clash = def.instances.find(i => idTaken(i.id))
      if (clash) return failure('exists', `instance id ${clash.id} is taken`)
      defs.set(def.id, def)
      return success(undefined)
    },
    definition: rid => defs.get(rid),
    open: rid => open(rid),
    place,
    runtimes: () => [...new Set([...kids.keys(), ...defs.keys()])],
    tag(c, t) { tags.set(c, (tags.get(c) ?? new Set()).add(t)) },
    untag(c, t) { tags.get(c)?.delete(t) },
    tagsOf,
  }
}
