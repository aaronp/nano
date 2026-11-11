// Start-up and autosave of the working copy, over injected deps (boot-app.ts passes the page's real ones).
import { Ops, type Runtime, type Trace } from '@pritzlaff/nano-core'
import { PlatformOps as P, runtimeOf } from '@composable/platform'
import { RESERVED } from '@composable/shell'
import type { AppCatalog } from '../sandbox/deploy.ts'
import { applyApp, type ApplyDeps } from './apply.ts'
import { snapshotApp, value, type Stores } from './snapshot.ts'
import type { appStore } from './store.ts'

export type Deps = { host: Runtime; stores: Stores; app: ReturnType<typeof appStore>; catalog: AppCatalog; importPackage: ApplyDeps['importPackage']; waits?: ApplyDeps['waits'] }

/**
 * With a working copy, applies it (replace) and reports its notes and the imports that failed; without one, nothing.
 * The working copy is the source of truth on start-up: the imports store is emptied first so every import in it is
 * loaded by apply (which then rewrites the store); a failed import stays in the store (and so in the next snapshot).
 * Consent for code is given: this is the person's own working copy.
 */
export async function restoreApp({ host, stores, app, catalog, importPackage, waits }: Deps): Promise<{ restored: boolean; notes: string[]; failed: { url: string; error: string }[] }> {
  const w = app.working()
  if (!w) return { restored: false, notes: [], failed: [] }
  const before = stores.imports.list(), failed: { url: string; error: string }[] = []
  stores.imports.set([])
  const notes = await applyApp(w, 'replace', { host, stores, catalog, consentCode: () => true, waits,
    importPackage: async (url, trust) => { const r = await importPackage(url, trust); if (r.error) failed.push({ url, error: r.error }); return r } })
  const kept = stores.imports.list()
  stores.imports.set([...kept, ...before.filter(r => failed.some(f => f.url === r.url) && !kept.some(k => k.url === r.url))])
  return { restored: true, notes, failed }
}

const CHANGES = ['nano:changed', 'catalog:changed', 'app-theme-change', 'imports:remove']
const SETTING = /\/(configure|set[A-Za-z]*)$/

/**
 * Writes the working copy 500 ms after the last change (coalesced; one snapshot at a time). Signals: document events
 * (`nano:changed` from the stores and docks, catalog:changed, theme, imports:remove), and the host's own traces: the
 * platform publishing `systems` (any instance or wire added or removed), and a configure/set* call or delivery on any
 * system's instances (a config changed). The snapshot's own calls come from 'app' and are ignored.
 */
export function autosave({ host, stores, app, doc, delay = 500 }: Pick<Deps, 'host' | 'stores' | 'app'> & { doc: Document; delay?: number }) {
  let timer: ReturnType<typeof setTimeout> | undefined, busy = false, again = false, stopped = false
  const watched = new Map<string, () => void>()
  const schedule = () => { if (stopped) return; clearTimeout(timer); timer = setTimeout(run, delay) }
  const onTrace = (t: Trace) => {
    if (t.from.instance === 'app') return
    if (t.kind === 'publish' ? t.op === Ops.key(P.systems) : (!RESERVED(t.target) && SETTING.test(t.op) && 'value' in t.result)) schedule()
  }
  const watch = async () => {
    const snaps = ((await value(host, { registry: host.registry.id, instance: 'app' }, 'platform', Ops.key(P.systems))) ?? []) as { id: string }[]
    for (const s of snaps) { const rt = s.id === host.registry.id ? host : runtimeOf(host.registry, s.id); if (rt && !watched.has(s.id)) watched.set(s.id, rt.listen(onTrace)) }
  }
  async function run() {
    if (busy) { again = true; return }
    busy = true
    try { await watch(); app.setWorking(await snapshotApp({ host, stores })) } catch { /* the next change tries again */ } finally { busy = false; if (again) { again = false; schedule() } }
  }
  for (const e of CHANGES) doc.addEventListener(e, schedule)
  schedule()   // without a working copy, the first snapshot becomes it
  return { stop() { stopped = true; clearTimeout(timer); for (const e of CHANGES) doc.removeEventListener(e, schedule); watched.forEach(off => off()) }, flush: run }
}
