/**
 * The host's live outline (spec §3), on the Outline's pure `parse`, `resolve` and `movedPages`: it keeps the document
 * and its version, applies a `next` all or nothing (a stale `base` refused), tells listeners what changed, re-resolves
 * on each Application `applied`, and opens a page (`getOrCreate` per resolved pod: the one start path).
 *
 *   const o = live(app, registry, doc)
 *   o.apply(next, { base: o.document().version })   // listeners hear { added, removed, changed, moved, resolved } before it returns
 *   await o.open('home')                            // per slot: { pod, started }, { fail }, or the resolution (missing, tool)
 */
import { failure, success, type Application, type Fail, type NanoResult, type PodCoord, type Registry } from '@pritzlaff/nano-core'
import { movedPages, Outline, resolve, type Page } from '@pritzlaff/nano-outline'

type Resolved = ReturnType<typeof resolve>[string]
type Opened = { pod: PodCoord; started: boolean } | { fail: Fail } | Exclude<Resolved, { kind: 'pod' }>
type Change = { added: string[]; removed: string[]; changed: string[]; moved: string[]; resolved: string[] }

const text = (v: unknown) => JSON.stringify(v)
/** A page as `changed` compares it: its place (`children`) is `moved`'s. */
const own = (p: Page) => text({ ...p, children: undefined })

export function live(app: Application, registry: Registry, doc: Outline) {
  let current = doc, version = 0
  const listeners = new Set<(c: Change) => void>()
  // a throwing listener is swallowed, as the Application's are (D79)
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
    document: (): { doc: Outline; version: number } => ({ doc: current, version }),
    /** `next` (shape and tree checked, copied) in place of the document, unless `base` is no longer the version. */
    apply(next: Outline, opts: { base?: number } = {}): NanoResult<void> {
      if (opts.base !== undefined && opts.base !== version) return failure('invalid-input', 'the pages changed since')
      const r = Outline.parse(JSON.parse(text(next)))
      if (!r.ok) return r
      const was = current.pages, now = r.value.pages
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
