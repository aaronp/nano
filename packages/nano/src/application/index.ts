/**
 * The Application: the one live thing. It is created from runtimes (values), builds eager pods at once and lazy ones
 * on first need, carries every message through the runtime it travels in, and reports all of it on one stream.
 *
 *   const app = (await Application.create(assemble(appDeployment, registry).value, {})).value
 *   await app.call('app', 'counter').inc(null)   // from 'host', through runtime 'app'
 *   app.listen(e => …)                           // built, sent, delivered, denied, failure, …
 *   await app.close()                            // every instance closed, deliveries under way settled; later calls not-found
 */
import { Value } from 'typebox/value'
import { assemble, type AppDeployment } from '../deployment.ts'
import type { Implementation } from '../implementation.ts'
import type { Pod } from '../pod.ts'
import type { Policy } from '../policy.ts'
import { createRegistry } from '../registry.ts'
import { failure, success, type NanoResult } from '../result.ts'
import type { Runtime } from '../runtime.ts'
import { diff } from './apply.ts'
import { compose } from './compose.ts'
import { instances } from './instances.ts'
import { client } from './emit.ts'
import { refusal, type Live } from './messages.ts'
import { stream, type AppEvent } from './stream.ts'

export type { AppEvent } from './stream.ts'

export type Application = {
  call(runtime: string, pod: string): Record<string, (input: unknown) => Promise<NanoResult<unknown>>>
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
  const composed = compose(runtimes)
  if (!composed.ok) return composed
  // No runtimes, no Pods and so no registry: such an application can only apply deployments naming no implementation.
  const registry = composed.value.registry ?? createRegistry()
  let current = composed.value.deployment, queue: Promise<unknown> = Promise.resolve()
  /** Set when `close()` is called: from then on `apply` and `restart` are refused; work queued before still runs. */
  let closing: Promise<NanoResult<void>> | undefined
  const trace = stream()
  const live: Live = {
    now: () => current, registry, policies: opts.policies ?? {}, timeoutMs: opts.timeoutMs ?? 30_000, trace,
    instance: name => pods.get(name), ons: new Set(), flying: new Set(), closed: () => closing !== undefined, isolate: opts.isolate,
  }
  const pods = instances(live)
  const buildEager = (names: string[]) => Promise.all(names.filter(n => current.pods[n]!.eager).map(n => pods.get(n)))
  await buildEager(Object.keys(current.pods))

  /** The first refusal of a subscription `next` adds, by the policy of the runtime it is added in. */
  function refused(next: AppDeployment): string | undefined {
    for (const [id, r] of Object.entries(next.runtimes))
      for (const s of r.subscriptions) {
        if (current.runtimes[id]?.subscriptions.some(x => Value.Equal(x, s))) continue
        const why = refusal(live, id, s.from, s.to, 'subscribe')
        if (why !== undefined) return why
      }
  }

  /** `d` assembled with the application's registry, then composed. */
  function adopt(d: AppDeployment): NanoResult<AppDeployment> {
    const assembled = assemble(d, registry)
    if (!assembled.ok) return assembled
    const next = compose(assembled.value)
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
    const why = refused(checked.value)
    if (why !== undefined) return failure('denied', why)
    const changes = diff(current, checked.value)
    current = checked.value
    for (const o of [...live.ons]) if (o.gone()) live.ons.delete(o)   // an edge removed now stays gone if re-added
    await Promise.all([...changes.removed.map(n => pods.forget(n, 'removed')), ...changes.changed.map(n => pods.forget(n, 'changed'))])
    await buildEager([...changes.added, ...changes.changed])
    trace.emit({ type: 'applied', ...changes })
    return success(undefined)
  }

  return success({
    call: (runtime, pod) => client(live, runtime, 'host', pod, () => closing ? failure('not-found', 'application is closed')
      : current.runtimes[runtime]?.pods.includes(pod) ? undefined : failure('not-found', `${pod} is not placed in ${runtime}`)),
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
    close: () => closing ??= queued(async () => { await Promise.all([pods.close(), ...live.flying]); return success(undefined) }),
  })
}

export const Application = { create }
