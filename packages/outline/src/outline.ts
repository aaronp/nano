/**
 * The Outline: one document, a tree of pages, changed by one `apply`, its slots resolved against the Application and
 * opened with `getOrCreate`. It owns no pods and deploys nothing; a slot naming an absent pod resolves `missing`.
 *
 *   const p = Outline.create(app, registry, doc)
 *   p.apply(next)                     // all or nothing (a broken tree refused); listeners hear { added, removed, changed, moved } before it returns
 *   p.apply(next, { base: 3 })        // refused unless the document is still at version 3
 *   p.resolve('home')                 // per slot: { kind: 'pod', pods }, { kind: 'missing' } or { kind: 'view', view }
 *   await p.open('home')              // per slot: { pod, started }, { fail }, or the resolution (missing, view)
 *   p.listen(c => …)                  // after an Application `applied`, `resolved` names the pages that resolve differently; a throw is swallowed
 */
import { Coord, failure, matches, success, type Application, type Fail, type NanoResult, type PodCoord, type Registry } from '@pritzlaff/nano-core'
import { parse, type Page, type Slot, type Outline as Doc } from './document.ts'
import { targets } from './targets.ts'
import { movedPages } from './tree.ts'

type Resolved = { kind: 'pod'; pods: PodCoord[] } | { kind: 'missing' } | { kind: 'view'; view: string }
type Opened = { pod: PodCoord; started: boolean } | { fail: Fail } | Exclude<Resolved, { kind: 'pod' }>
type Change = { added: string[]; removed: string[]; changed: string[]; moved: string[]; resolved: string[] }

const MISSING: Resolved = { kind: 'missing' }
/** Shape-checked and copied: written out and read back. */
const copy = (doc: Doc) => parse(JSON.parse(JSON.stringify(doc)))
const text = (v: unknown) => JSON.stringify(v)
/** A page as `changed` compares it: its place (`children`) is `moved`'s. */
const own = (p: Page) => text({ ...p, children: undefined })

function create(app: Application, registry: Registry, doc: Doc = { roots: [], pages: {} }) {
  const first = copy(doc)
  if (!first.ok) throw new Error(first.fail.reason)
  let current = first.value, version = 0
  const listeners = new Set<(c: Change) => void>()
  // a throwing listener is swallowed, as the Application's are (D79): the document stays applied and the rest still hear it
  const tell = (c: Change) => { for (const fn of [...listeners]) try { fn(c) } catch { /* swallowed */ } }

  const slot = (s: Slot): Resolved => {
    if (s.kind === 'view') return { kind: 'view', view: s.view }
    const d = app.deployment(), target = targets(d, registry)
    if (s.kind === 'pod') {
      const { implementation, runtime, pod } = s.pod
      return d.runtimes[runtime.id]?.pods.includes(pod) && d.pods[pod]?.implementation === String(implementation) ? { kind: 'pod', pods: [s.pod] } : MISSING
    }
    const pods = Object.keys(d.runtimes).sort().flatMap(r => [...d.runtimes[r]!.pods].sort().flatMap(p => {
      const t = target(p, r)
      return t && matches(s.select, t) ? [Coord.pod(Coord.parse('implementation', t.implementation), Coord.runtime(r), p)] : []
    }))
    return pods.length ? { kind: 'pod', pods } : MISSING
  }
  const resolve = (id: string): Record<string, Resolved> =>
    Object.fromEntries(Object.entries(current.pages[id]?.slots ?? {}).map(([s, v]) => [s, slot(v)]))
  const snapshot = () => Object.fromEntries(Object.keys(current.pages).map(p => [p, text(resolve(p))]))
  let seen = snapshot()

  app.listen(e => {
    if (e.type !== 'applied') return
    const now = snapshot(), resolved = Object.keys(now).filter(p => now[p] !== seen[p])
    seen = now
    if (resolved.length) tell({ added: [], removed: [], changed: [], moved: [], resolved })
  })

  return {
    document: (): { doc: Doc; version: number } => ({ doc: current, version }),
    apply(next: Doc, opts: { base?: number } = {}): NanoResult<void> {
      if (opts.base !== undefined && opts.base !== version) return failure('invalid-input', 'the pages changed since')
      const r = copy(next)
      if (!r.ok) return r
      const was: Record<string, Page> = current.pages, now = r.value.pages
      const change: Change = {
        added: Object.keys(now).filter(p => !(p in was)), removed: Object.keys(was).filter(p => !(p in now)),
        changed: Object.keys(now).filter(p => p in was && own(now[p]!) !== own(was[p]!)), moved: movedPages(current, r.value), resolved: [],
      }
      if (!change.added.length && !change.removed.length && !change.changed.length && !change.moved.length) return success(undefined)
      current = r.value; version++; seen = snapshot()
      tell(change)
      return success(undefined)
    },
    resolve,
    async open(id: string): Promise<Record<string, Opened>> {
      const opened = await Promise.all(Object.entries(resolve(id)).map(async ([s, r]): Promise<[string, Opened]> => {
        if (r.kind !== 'pod') return [s, r]
        const pod = r.pods[0]!, got = await app.runtime(pod.runtime.id).getOrCreate(pod.pod)
        return [s, got.ok ? { pod, started: got.value.started } : { fail: got.fail }]
      }))
      return Object.fromEntries(opened)
    },
    listen(fn: (c: Change) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn) } },
  }
}

/** `Outline.create(app, registry, doc?)` (a malformed `doc` throws) and `Outline.parse(json)`, the save/load seam. */
export const Outline = { create, parse }
export type Outline = Doc
