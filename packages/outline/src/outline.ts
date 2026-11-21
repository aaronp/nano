/**
 * The Outline: one document, a tree of pages, changed by one `apply`, its slots resolved against the Application and
 * opened with `getOrCreate`. It owns no pods and deploys nothing; a slot naming an absent pod resolves `missing`.
 *
 *   const p = Outline.create(app, registry, doc)
 *   p.apply(next)                     // all or nothing (a broken tree refused); listeners hear { added, removed, changed, moved } before it returns
 *   p.apply(next, { base: 3 })        // refused unless the document is still at version 3
 *   p.resolve('home')                 // per slot: { kind: 'pod', pods }, { kind: 'missing' } or { kind: 'tool', tool }
 *   await p.open('home')              // per slot: { pod, started }, { fail }, or the resolution (missing, tool)
 *   resolve(doc, 'home', app.deployment(), registry)   // the same, pure: no app
 *   p.listen(c => …)                  // after an Application `applied`, `resolved` names the pages that resolve differently; a throw is swallowed
 */
import { Coord, failure, matches, success, type Application, type AppDeployment, type Fail, type NanoResult, type PodCoord, type Registry } from '@pritzlaff/nano-core'
import { parse, type Page, type Slot, type Outline as Doc } from './document.ts'
import { targets } from './targets.ts'
import { movedPages } from './tree.ts'

type Resolved = { kind: 'pod'; pods: PodCoord[] } | { kind: 'missing' } | { kind: 'tool'; tool: string }
type Opened = { pod: PodCoord; started: boolean } | { fail: Fail } | Exclude<Resolved, { kind: 'pod' }>
type Change = { added: string[]; removed: string[]; changed: string[]; moved: string[]; resolved: string[] }

const MISSING: Resolved = { kind: 'missing' }
/** Shape-checked and copied: written out and read back. */
const copy = (doc: Doc) => parse(JSON.parse(JSON.stringify(doc)))
const text = (v: unknown) => JSON.stringify(v)
/** A page as `changed` compares it: its place (`children`) is `moved`'s. */
const own = (p: Page) => text({ ...p, children: undefined })

/** Page `page` of `outline`, each slot resolved against `deployment`: the pod where placed with that implementation, every
 * placed pod a selector matches (by runtime, then pod), the tool, or `missing`. Pure. */
export function resolve(outline: Doc, page: string, deployment: AppDeployment, registry: Registry): Record<string, Resolved> {
  const d = deployment, target = targets(d, registry)
  const slot = (s: Slot): Resolved => {
    if (s.kind === 'tool') return { kind: 'tool', tool: s.tool }
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
  return Object.fromEntries(Object.entries(outline.pages[page]?.slots ?? {}).map(([s, v]) => [s, slot(v)]))
}

function create(app: Application, registry: Registry, doc: Doc = { roots: [], pages: {} }) {
  const first = copy(doc)
  if (!first.ok) throw new Error(first.fail.reason)
  let current = first.value, version = 0
  const listeners = new Set<(c: Change) => void>()
  // a throwing listener is swallowed, as the Application's are (D79): the document stays applied and the rest still hear it
  const tell = (c: Change) => { for (const fn of [...listeners]) try { fn(c) } catch { /* swallowed */ } }

  const resolveIn = (id: string) => resolve(current, id, app.deployment(), registry)
  const snapshot = () => Object.fromEntries(Object.keys(current.pages).map(p => [p, text(resolveIn(p))]))
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
    resolve: resolveIn,
    async open(id: string): Promise<Record<string, Opened>> {
      const opened = await Promise.all(Object.entries(resolveIn(id)).map(async ([s, r]): Promise<[string, Opened]> => {
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
