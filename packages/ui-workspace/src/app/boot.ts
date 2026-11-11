// Start-up and autosave of the working copy, over injected deps (boot-app.ts passes the page's real ones).
import { Ops, type Runtime, type Trace } from '@pritzlaff/nano-core'
import { PlatformOps as P, runtimeOf } from '@composable/platform'
import { checkApp, RESERVED, type NanoApp } from '@composable/shell'
import type { AppCatalog } from '../sandbox/deploy.ts'
import { applyApp, type ApplyDeps } from './apply.ts'
import { snapshotApp, value, type Stores } from './snapshot.ts'
import type { appStore } from './store.ts'

export type Deps = { host: Runtime; stores: Stores; app: ReturnType<typeof appStore>; catalog: AppCatalog; importPackage: ApplyDeps['importPackage']; waits?: ApplyDeps['waits'] }
export type Restore = {
  /** A working copy was applied (so its imports are loaded and bootImports is not needed). */
  restored: boolean
  /** The page must not write a start-up snapshot: it could overwrite a copy that was only partly applied or not readable. */
  protect: boolean
  notes: string[]; failed: { url: string; error: string }[]
  /** What to tell the person, if anything. */
  say?: string
}

/**
 * With a working copy, applies it (replace); without one, nothing. The working copy is the source of truth on
 * start-up: the imports store is emptied first so every import in it is loaded by apply, then rebuilt from the copy's
 * own list (a failed import keeps its record). Consent for code is given: this is the person's own copy.
 * Never throws. A copy that cannot be read is kept as `nano.working.bad`; one that applied with notes or failures is
 * kept as `nano.working.unrestored`, and in both cases `protect` says not to snapshot over it.
 */
export async function restoreApp({ host, stores, app, catalog, importPackage, waits }: Deps): Promise<Restore> {
  const raw = app.rawWorking(), w = app.working()
  if (raw === null) return { restored: false, protect: false, notes: [], failed: [] }
  if (!w) {
    const e = app.stash('bad', raw)
    return { restored: false, protect: true, notes: [], failed: [], say: `The saved working copy could not be read, so this started from the default app.${e ? ` It could not be kept either: ${e}` : ' The unreadable copy is kept in this browser as nano.working.bad.'}` }
  }
  /** Keeps the copy as `unrestored` unless one is there already: the first is the complete one, a later copy may have been degraded by a partial restore. */
  const keep = () => {
    if (app.stashed('unrestored') !== null) return 'An earlier complete copy is already kept in this browser as nano.working.unrestored (this one was not kept over it).'
    const e = app.stash('unrestored', raw)
    return e ? `The complete copy could not be kept: ${e}` : 'The complete copy is kept in this browser as nano.working.unrestored.'
  }
  const failed: { url: string; error: string }[] = []
  let notes: string[]
  const before = (() => { try { return stores.imports.list() } catch { return [] } })()
  try {
    stores.imports.set([])
    notes = await applyApp(w, 'replace', { host, stores, catalog, consentCode: () => true, waits,
      importPackage: async (url, trust) => { const r = await importPackage(url, trust); if (r.error) failed.push({ url, error: r.error }); return r } })
    const kept = stores.imports.list()
    stores.imports.set(w.imports.map(i => kept.find(k => k.url === i.url) ?? before.find(b => b.url === i.url) ?? { url: i.url, name: i.url, version: '', trust: i.trust }))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    try { stores.imports.set(before) } catch { /* the same failure again */ }
    return { restored: false, protect: true, notes: [`stopped: ${msg}`], failed, say: `Your saved app could not be restored (${msg}); the page started as usual. ${keep()}` }
  }
  if (!notes.length && !failed.length) return { restored: true, protect: false, notes, failed }
  return { restored: true, protect: true, notes, failed, say: `Your saved app was restored with ${notes.length} problem${notes.length === 1 ? '' : 's'} (first: ${notes[0] ?? failed[0]!.error}). ${keep()}` }
}

const CHANGES = ['nano:changed', 'catalog:changed', 'app-theme-change', 'imports:remove']
const SETTING = /\/(configure|set[A-Za-z]*)$/
const MAX_WAIT = 5000

/**
 * Writes the working copy 500 ms after the last change (coalesced, but never more than 5 s after the first of a
 * burst; one snapshot at a time). Signals: document events (`nano:changed` from the stores and docks, catalog:changed,
 * theme, imports:remove), and the host's own traces: the platform publishing `systems` (any instance or wire added
 * or removed), and a configure/set* call on any system's instances (a config changed; wired deliveries are data, not
 * configuration, and are ignored). The snapshot's own calls come from 'app' and are ignored.
 * `initial: false` writes nothing until the next real change (after a partial restore). `onError` hears a failed write.
 */
export function autosave({ host, stores, app, doc, delay = 500, initial = true, onError, maxWait = MAX_WAIT, win = doc.defaultView }: Pick<Deps, 'host' | 'stores' | 'app'> & {
  doc: Document; delay?: number; maxWait?: number; initial?: boolean; onError?(why: string): void; win?: Window | null }) {
  let timer: ReturnType<typeof setTimeout> | undefined, first = 0, busy = false, again = false, stopped = false, last: NanoApp | undefined
  const seen = new WeakSet<Runtime>(), offs = new Set<() => void>()
  const schedule = () => {
    if (stopped) return
    const now = Date.now(); if (!timer) first = now
    clearTimeout(timer); timer = setTimeout(run, Math.max(0, Math.min(delay, first + maxWait - now)))
  }
  const onTrace = (t: Trace) => {
    if (t.from.instance === 'app') return
    if (t.kind === 'publish') { if (t.op === Ops.key(P.systems)) { schedule(); void watch() } }
    else if (t.kind === 'call' && !RESERVED(t.target) && SETTING.test(t.op) && 'value' in t.result) schedule()
  }
  async function watch() {
    const snaps = ((await value(host, { registry: host.registry.id, instance: 'app' }, 'platform', Ops.key(P.systems))) ?? []) as { id: string }[]
    for (const s of snaps) { const rt = s.id === host.registry.id ? host : runtimeOf(host.registry, s.id); if (rt && !seen.has(rt)) { seen.add(rt); offs.add(rt.listen(onTrace)) } }
  }
  async function run() {
    timer = undefined
    if (busy) { again = true; return }
    busy = true
    try {
      await watch()
      last = await snapshotApp({ host, stores })
      const e = app.setWorking(last); if (e) onError?.(e)
    } catch { /* the next change tries again */ } finally { busy = false; if (again) { again = false; schedule() } }
  }
  // on close: write the last finished snapshot at once, and start a new one
  // ponytail: an async snapshot cannot finish during unload, so changes in the last <500 ms can be lost; a sync snapshot path would close the gap
  const flush = () => { if (stopped) return; if (timer && last) { app.setWorking(last) } if (timer) { clearTimeout(timer); void run() } }
  const hide = () => { if (doc.visibilityState === 'hidden') flush() }
  for (const e of CHANGES) doc.addEventListener(e, schedule)
  win?.addEventListener('pagehide', flush); doc.addEventListener('visibilitychange', hide)
  if (initial) schedule()   // without a working copy, the first snapshot becomes it
  else void watch()
  return { stop() { stopped = true; clearTimeout(timer); for (const e of CHANGES) doc.removeEventListener(e, schedule); doc.removeEventListener('visibilitychange', hide); win?.removeEventListener('pagehide', flush); offs.forEach(off => off()) }, flush }
}
