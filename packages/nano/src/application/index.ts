/**
 * The Application: the one live thing. It is created from a deployment value, builds eager pods at once and lazy ones
 * on first need, carries every message through the runtime it travels in, and reports all of it on one stream.
 *
 *   const app = (await Application.create(deployment, { registry })).value
 *   await app.call('app', 'counter').inc(null)   // from 'host', through runtime 'app'
 *   app.listen(e => …)                           // built, sent, delivered, denied, failure, …
 */
import { checkDeployment, type Deployment } from '../deployment.ts'
import type { Policy } from '../policy.ts'
import type { Registry } from '../registry.ts'
import { failure, success, type NanoResult } from '../result.ts'
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
  const current = checked.value
  const trace = stream()
  const live: Live = {
    now: () => current, registry: opts.registry, policies: opts.policies ?? {}, timeoutMs: opts.timeoutMs ?? 30_000, trace,
    instance: name => pods.get(name),
  }
  const pods = instances(live)
  await Promise.all(Object.entries(current.pods).filter(([, p]) => p.eager).map(([name]) => pods.get(name)))

  return success({
    call: (runtime, pod) => client(live, runtime, 'host', pod, () =>
      current.runtimes[runtime]?.pods.includes(pod) ? undefined : `${pod} is not placed in ${runtime}`),
    apply: async () => failure('invalid-input', 'not built yet'),
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
