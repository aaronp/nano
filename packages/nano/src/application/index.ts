/**
 * The Application: the one live thing. It is created from a deployment value, builds eager pods at once and lazy ones
 * on first need, carries every message through the runtime it travels in, and reports all of it on one stream.
 *
 *   const app = (await Application.create(deployment, { registry })).value
 *   await app.call('app', 'counter').inc(null)   // from 'host', through runtime 'app'
 *   app.listen(e => …)                           // built, sent, delivered, denied, failure, …
 */
import { Value } from 'typebox/value'
import { checkDeployment, type Deployment } from '../deployment.ts'
import type { Policy } from '../policy.ts'
import type { Registry } from '../registry.ts'
import { failure, success, type NanoResult } from '../result.ts'
import { diff } from './apply.ts'
import { instances } from './instances.ts'
import { client, refusal, type Live } from './messages.ts'
import { stream, type AppEvent } from './stream.ts'

export type { AppEvent } from './stream.ts'

export type Application = {
  call(runtime: string, pod: string): Record<string, (input: unknown) => Promise<NanoResult<unknown>>>
  apply(next: Deployment): Promise<NanoResult<void>>
  restart(pod: string): Promise<NanoResult<void>>
  deployment(): Deployment
  listen(fn: (e: AppEvent) => void): () => void
}

type Opts = { registry: Registry; policies?: Record<string, Policy>; timeoutMs?: number }

const bare = <T>(o: Record<string, T>): Record<string, T> => Object.assign(Object.create(null), o)

/**
 * `d` checked, as the application's own copy: nobody else holds it, so only `apply` changes it; and its maps have no
 * prototype, so a pod or runtime named `constructor` or `toString` is only ever a name.
 */
function adopt(d: unknown, registry: Registry): NanoResult<Deployment> {
  let copy: unknown
  try { copy = structuredClone(d) } catch (e) { return failure('invalid-input', `unreadable deployment: ${e instanceof Error ? e.message : String(e)}`) }
  const checked = checkDeployment(copy, registry)
  if (!checked.ok) return checked
  const { pods, runtimes, tags } = checked.value
  return success({ ...checked.value, pods: bare(pods), runtimes: bare(runtimes), ...(tags && { tags: bare(tags) }) })
}

async function create(d: unknown, opts: Opts): Promise<NanoResult<Application>> {
  const checked = adopt(d, opts.registry)
  if (!checked.ok) return checked
  let current = checked.value, queue: Promise<unknown> = Promise.resolve()
  const trace = stream()
  const live: Live = {
    now: () => current, registry: opts.registry, policies: opts.policies ?? {}, timeoutMs: opts.timeoutMs ?? 30_000, trace,
    instance: name => pods.get(name),
  }
  const pods = instances(live)
  const buildEager = (names: string[]) => Promise.all(names.filter(n => current.pods[n]!.eager).map(n => pods.get(n)))
  await buildEager(Object.keys(current.pods))

  /** The first refusal of a subscription `next` adds, by the policy of the runtime it is added in. */
  function refused(next: Deployment): string | undefined {
    for (const [id, r] of Object.entries(next.runtimes))
      for (const s of r.subscriptions) {
        if (current.runtimes[id]?.subscriptions.some(x => Value.Equal(x, s))) continue
        const why = refusal(live, id, s.from, s.to, 'subscribe')
        if (why !== undefined) return why
      }
  }

  async function reconcile(d: unknown): Promise<NanoResult<void>> {
    const checked = adopt(d, opts.registry)
    if (!checked.ok) return checked
    const why = refused(checked.value)
    if (why !== undefined) return failure('denied', why)
    const changes = diff(current, checked.value)
    current = checked.value
    for (const name of [...changes.removed, ...changes.changed]) pods.forget(name)
    await buildEager([...changes.added, ...changes.changed])
    trace.emit({ type: 'applied', ...changes })
    return success(undefined)
  }

  return success({
    call: (runtime, pod) => client(live, runtime, 'host', pod, () =>
      current.runtimes[runtime]?.pods.includes(pod) ? undefined : `${pod} is not placed in ${runtime}`),
    apply(next) {
      const done = queue.then(() => reconcile(next))
      queue = done.catch(() => undefined)
      return done
    },
    async restart(pod) {
      if (!current.pods[pod]) return failure('not-found', `no pod ${pod}`)
      pods.forget(pod)
      trace.emit({ type: 'restarted', pod })
      if (current.pods[pod].eager) await pods.get(pod)
      return success(undefined)
    },
    deployment: () => structuredClone(current),
    listen: trace.listen,
  })
}

export const Application = { create }
