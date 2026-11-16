/**
 * The Application: the one live thing. It is created from runtimes (values), builds eager pods at once and lazy ones
 * on first need, carries every message through the runtime it travels in, and reports all of it on one stream.
 *
 *   const app = (await Application.create(AppDeployment.assemble(appDeployment, registry).value, {})).value
 *   const front = app.runtime('front')           // the host as a member of runtime 'front': what it places, policed by its policy
 *   await front.call('counter').inc(null)        // from 'host', through runtime 'front' (app.call('front', 'counter') too)
 *   await front.get(Counter).inc()               // the one pod there providing Counter, as a plain object; a Fail throws
 *   app.resolve(Counter)                         // app.runtime(the one runtime).resolve(Counter); several: not-unique
 *   const app = await Application.load(new URL('./nano.json', import.meta.url))   // modules loaded, assembled, created
 *   app.listen(e => …)                           // built, sent, delivered, denied, failure, …
 *   await app.close()                            // every instance closed, deliveries under way settled; later calls not-found
 */
import { AppDeployment } from '../deployment.ts'
import type { Implementation } from '../implementation.ts'
import type { Pod } from '../pod.ts'
import type { Policy } from '../policy.ts'
import { Registry } from '../registry.ts'
import { failure, success, type NanoResult } from '../result.ts'
import type { Runtime } from '../runtime.ts'
import { diff } from './apply.ts'
import { loaded } from './load.ts'
import { compose } from './compose.ts'
import { instances } from './instances.ts'
import { notifyPodChanges } from './pod-changes.ts'
import { refusal, type Live } from './messages.ts'
import { runtimeView, type RuntimeView } from './resolve.ts'
import { stream, type AppEvent } from './stream.ts'

export type { AppEvent } from './stream.ts'
export type { Resolution } from './resolve.ts'

export type Application = {
  /** The runtime `id` as the host sees it; `resolve`, `get`, `call` and `subscribe` below are those of the one runtime (else `not-unique`). */
  runtime(id: string): RuntimeView
  /** `app.call(pod)`; `app.call(runtime, pod)` is `app.runtime(runtime).call(pod)`. */
  call(...at: [pod: string] | [runtime: string, pod: string]): ReturnType<RuntimeView['call']>
  get: RuntimeView['get']
  resolve: RuntimeView['resolve']
  subscribe: RuntimeView['subscribe']
  apply(next: AppDeployment): Promise<NanoResult<void>>
  restart(pod: string): Promise<NanoResult<void>>
  deployment(): AppDeployment
  listen(fn: (e: AppEvent) => void): () => void
  close(): Promise<NanoResult<void>>
}

/** `isolate` gives the host's stand-in for a pod whose isolation isn't 'host' (same coord); without it such a pod fails. */
type Opts = { policies?: Record<string, Policy>; timeoutMs?: number; isolate?: (name: string, pod: Pod) => Implementation }

/**
 * `runtimes` live. The application's deployment is its own: nobody else holds it, so only `apply` changes it; and its
 * maps have no prototype, so a pod or runtime named `constructor` or `toString` is only ever a name.
 */
async function create(runtimes: Record<string, Runtime>, opts: Opts = {}): Promise<NanoResult<Application>> {
  const composed = compose(runtimes, opts.policies)
  if (!composed.ok) return composed
  // No runtimes, no Pods and so no registry: such an application can only apply deployments naming no implementation.
  const registry = composed.value.registry ?? Registry.create()
  let current = composed.value.deployment, queue: Promise<unknown> = Promise.resolve()
  /** Set when `close()` is called: from then on `apply` and `restart` are refused; work queued before still runs. */
  let closing: Promise<NanoResult<void>> | undefined
  const trace = stream()
  const live: Live = {
    now: () => current, registry, policies: opts.policies ?? {}, timeoutMs: opts.timeoutMs ?? 30_000, trace,
    instance: name => pods.get(name), listeners: { ons: new Set(), heard: new Map(), podChanges: new Set() }, flying: new Set(), closed: () => closing !== undefined, isolate: opts.isolate,
  }
  const pods = instances(live)
  const buildEager = (names: string[]) => Promise.all(names.filter(n => current.pods[n]!.eager).map(n => pods.get(n)))
  await buildEager(Object.keys(current.pods))

  /** `d` assembled with the application's registry, then composed. */
  function adopt(d: AppDeployment): NanoResult<AppDeployment> {
    const assembled = AppDeployment.assemble(d, registry)
    if (!assembled.ok) return assembled
    const next = compose(assembled.value, live.policies)
    return next.ok ? success(next.value.deployment) : next
  }

  const shut = () => failure('invalid-input', 'application is closed')
  /** `work` after every change (apply, restart, close) queued before it. */
  function queued<T>(work: () => Promise<T>): Promise<T> {
    const done = queue.then(work)
    queue = done.catch(() => undefined)
    return done
  }

  async function reconcile(d: AppDeployment): Promise<NanoResult<void>> {
    const checked = adopt(d)
    if (!checked.ok) return checked
    const changes = diff(current, checked.value), before = current
    current = checked.value
    for (const o of [...live.listeners.ons]) {
      if (o.gone()) { o.end(); continue }   // an edge removed now stays gone if re-added
      const why = refusal(live, { runtime: o.runtime, kind: 'subscribe', from: o.to, to: o.from, port: o.port })   // asked again on apply; a refused one is dropped
      if (why !== undefined) o.end({ type: 'denied', reason: why })
    }
    await Promise.all([...changes.removed.map(n => pods.forget(n, 'removed')), ...changes.changed.map(n => pods.forget(n, 'changed'))])
    await buildEager([...changes.added, ...changes.changed])
    await notifyPodChanges(live, before)
    trace.emit({ type: 'applied', ...changes })
    return success(undefined)
  }

  const one = runtimeView(live)
  const app: Application = {
    runtime: id => runtimeView(live, id),
    resolve: (api, where) => one.resolve(api, where),
    get: (api, where) => one.get(api, where),
    subscribe: one.subscribe,
    call: (...at) => at.length === 1 ? one.call(at[0]) : app.runtime(at[0]).call(at[1]),
    apply: next => closing ? Promise.resolve(shut()) : queued(() => reconcile(next)),
    restart: pod => closing ? Promise.resolve(shut()) : queued(async () => {
      if (!current.pods[pod]) return failure('not-found', `no pod ${pod}`)
      await pods.forget(pod, 'restarted')
      trace.emit({ type: 'restarted', pod })
      if (current.pods[pod].eager) await pods.get(pod)
      return success(undefined)
    }),
    deployment: () => structuredClone(current),
    listen: trace.listen,
    // Deliveries under way settle; nothing new is delivered once `closing` is set.
    close: () => closing ??= queued(async () => { await Promise.all([pods.close(), ...live.flying]); for (const o of [...live.listeners.ons]) o.end(); live.listeners.podChanges.clear(); return success(undefined) }),
  }
  return success(app)
}

/** `create` from a nano.json: its `modules` loaded, assembled and created; the first failure throws an Error carrying it. */
async function load(url: string | URL, opts: Opts = {}): Promise<Application> {
  const l = await loaded(url)
  const r = l.ok ? AppDeployment.assemble(l.value.deployment, l.value.registry) : l
  const app = r.ok ? await create(r.value, opts) : r
  if (!app.ok) throw Object.assign(new Error(`${app.fail.type}: ${app.fail.reason}`), { fail: app.fail })
  return app.value
}

export const Application = { create, load }
