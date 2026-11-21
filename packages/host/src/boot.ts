/**
 * `Host.boot(storage, opts)`: the host document read (migrate.ts), its modules loaded by the host's loader beside the
 * host's own providers, in one registry, the one Application created with the host's pods first in `main`, and the
 * document saved under the one key on each `applied` and host change, until another tab writes it or storage refuses.
 *
 *   const h = (await Host.boot(localStorage, { base: location.href, providers: [ui] })).value
 *   h.document()                       // the HostDocument as saved: no host pods
 *   h.setHost({ views: { t1: 'x' } })  // saved
 */
import { AppDeployment, Application, failure, Registry, success, type NanoResult, type Pod, type Provider } from '@pritzlaff/nano-core'
import { KEY, OLD, write, type HostDocument } from './document.ts'
import { stored, type Migrate } from './migrate.ts'

export type Host = {
  app: Application; registry: Registry
  /** Each loaded module's namespace, by its key in `modules` (a web host reads `views` there). */
  exports: Record<string, Record<string, unknown>>
  /** The host document as saved: the live system without the host pods, its modules and frames, the outline, `host`. */
  document(): HostDocument
  /** Writes `host.views`/`host.layout` (each replaced as given) and saves. */
  setHost(patch: NonNullable<HostDocument['host']>): void
  /** Why saving stopped (another tab wrote, or storage refused), once it has. */
  stopped(): string | undefined
}
type Opts = {
  base: string | URL
  /** The host's loader (default: core's plain `Registry.load`, for trusted documents), asked once with the modules its own providers lack. */
  load?: typeof Registry.load
  /** The host's own; a module whose key (its provider's coordinate) names one of them is not loaded. */
  providers?: Provider[]
  create?: Parameters<typeof Application.create>[1]
  /** Placed first in `main`, never saved. */
  hostPods?: Record<string, Pod>
  migrate?: Migrate
  onStop?: () => void
}
const MAIN = 'main'

async function boot(storage: Storage, opts: Opts): Promise<NanoResult<Host>> {
  const read = stored(storage)
  if (!read.ok) return read
  const registry = Registry.create()
  for (const p of opts.providers ?? []) { const added = registry.add(p); if (!added.ok) return added }
  // One call to the host's loader (a gated one asks once); what it loaded joins the host's registry.
  const loaded = await (opts.load ?? Registry.load)(Object.fromEntries(Object.entries(read.value.doc.app.modules ?? {}).filter(([k]) => !registry.provider(k))), opts.base)
  if (!loaded.ok) return loaded
  for (const { coord } of loaded.value.registry.manifest().providers) { const added = registry.add(loaded.value.registry.provider(coord)!); if (!added.ok) return added }
  // The host's own old forms, read once its registry can name implementations: a pure data edit.
  const doc = read.value.old && opts.migrate ? opts.migrate(read.value.doc, storage, registry) : read.value.doc
  const { app: { modules, frames, ...system }, outline } = doc
  let host = doc.host

  const own = Object.keys(opts.hostPods ?? {}), mine = (p: string) => own.includes(p)
  const taken = own.find(p => p in system.pods)
  if (taken) return failure('invalid-input', `the stored document has a pod ${taken}, the host's own`)
  const made = !system.runtimes[MAIN], main = system.runtimes[MAIN] ?? { pods: [], subscriptions: [] }
  const placed = { ...system, pods: { ...opts.hostPods, ...system.pods }, runtimes: { ...system.runtimes, [MAIN]: { ...main, pods: [...own, ...main.pods] } } }
  const runtimes = AppDeployment.assemble(placed, registry)
  if (!runtimes.ok) return runtimes
  const created = await Application.create(runtimes.value, opts.create)
  if (!created.ok) return created
  const app = created.value

  /** `d` without the host pods, and without `main` when boot made it and nothing else is in it. */
  const unplaced = (d: AppDeployment): AppDeployment => {
    const keep = <T>(o: Record<string, T> = {}) => Object.fromEntries(Object.entries(o).filter(([p]) => !mine(p)))
    const runtimes = { ...d.runtimes }, m = runtimes[MAIN]
    if (m) {
      const pods = m.pods.filter(p => !mine(p)), subscriptions = m.subscriptions.filter(s => !mine(s.from) && !mine(s.to))
      if (made && !pods.length && !subscriptions.length) delete runtimes[MAIN]
      else runtimes[MAIN] = { ...m, pods, subscriptions }
    }
    return { pods: keep(d.pods), runtimes, ...(d.tags && { tags: keep(d.tags) }) }
  }
  const document = (): HostDocument => ({ app: { ...unplaced(app.deployment()), ...(modules && { modules }), ...(frames && { frames }) }, outline, ...(host && { host }) })
  let stopped: string | undefined
  const stop = (reason: string) => { if (stopped) return; stopped = reason; opts.onStop?.() }
  const save = () => { if (stopped) return; const failed = write(storage, document()); if (failed) stop(`not saved: ${failed}`) }
  /** `host.views` without the overrides for pods that are gone. */
  const prune = () => { const pods = app.deployment().pods; if (host?.views) host = { ...host, views: Object.fromEntries(Object.entries(host.views).filter(([p]) => p in pods)) } }
  app.listen(e => { if (e.type === 'applied') { prune(); save() } })
  const watched: string[] = [KEY, ...OLD]
  globalThis.addEventListener?.('storage', e => { if (watched.includes((e as StorageEvent).key ?? '')) stop('changed in another tab: reload to continue') })
  prune(); save()
  return success({ app, registry, exports: loaded.value.exports, document, stopped: () => stopped, setHost(patch) { host = { ...host, ...patch }; save() } })
}

/** `Host.boot(storage, opts)`. */
export const Host = { boot }
