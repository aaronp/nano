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
import { Policies, type Policy } from '../policy.ts'
import type { Registry } from '../registry.ts'
import { failure, success, type NanoResult } from '../result.ts'
import { diff } from './apply.ts'
import { instances } from './instances.ts'
import { client, type Live } from './messages.ts'
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

async function create(d: unknown, opts: Opts): Promise<NanoResult<Application>> {
  const checked = checkDeployment(d, opts.registry)
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

  /** The first refusal of a subscription `next` adds, by the policy of the runtime it is added in. A throw refuses. */
  function refusal(next: Deployment): string | undefined {
    for (const [id, r] of Object.entries(next.runtimes))
      for (const s of r.subscriptions) {
        if (current.runtimes[id]?.subscriptions.some(x => Value.Equal(x, s))) continue
        let v: unknown
        try { v = (live.policies[id] ?? Policies.allowAll()).isAllowed(s.from, s.to, 'subscribe') } catch (e) { return `policy threw: ${e instanceof Error ? e.message : String(e)}` }
        const verdict = v as { approved?: unknown; reason?: unknown } | undefined
        if (verdict?.approved !== true) return typeof verdict?.reason === 'string' && verdict.approved === false ? verdict.reason : 'policy gave no verdict'
      }
  }

  async function reconcile(d: unknown): Promise<NanoResult<void>> {
    const checked = checkDeployment(d, opts.registry)
    if (!checked.ok) return checked
    const why = refusal(checked.value)
    if (why) return failure('denied', why)
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
    deployment: () => current,
    listen: trace.listen,
  })
}

export const Application = { create }
