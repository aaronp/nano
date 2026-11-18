/**
 * Writing a deployment at the call site, as data. `AppDeployment.edit(base, registry)` copies `base`; nothing runs.
 * The registry is read only to know what each pod's implementation provides.
 *
 *   const d = AppDeployment.edit(app.deployment(), registry)
 *   d.place(kvMemory, { pod: 'store', in: 'backend' })
 *   const kvs = d.resolve('backend', KeyValueStoreDef.api)        // { runtime, pod, implementation }; not-found / not-unique throw
 *   kvs.create(todosKv, { pod: 'todos', in: 'frontend' })         // pod; edge todos→store in backend; a rule letting it in
 *   await app.apply(d.deployment())
 *
 * `pipe(runtime, { from, source, to, target })` appends that pipe to the runtime (both pods placed there; an equal pipe
 * is `invalid-input`); `unpipe(runtime, same)` removes it (`not-found` when there is none).
 *
 * `create` records a call edge in the resolved pod's runtime and, when that runtime's policy is `rules`, prepends
 * `{ allow: ['call', 'subscribe'], from, outside, toInterface }` (the first match wins: the operator asked for this edge).
 */
import type { AppDeployment } from './deployment.ts'
import type { Interface } from './iface.ts'
import type { Implementation } from './implementation.ts'
import { thrown } from './plain.ts'
import type { Registry } from './registry.ts'

type Where = { pod: string; in: string; eager?: boolean }
type PipeEnds = { from: string; source: string; to: string; target: string }
type Handle = { readonly runtime: string; readonly pod: string; readonly implementation: string; create(impl: Implementation, where: Where): Handle }

export function edit(base: AppDeployment, registry: Registry) {
  const d: AppDeployment = structuredClone(base)
  const runtime = (id: string) => (d.runtimes[id] ??= { pods: [], subscriptions: [] })
  const fail = (type: 'not-found' | 'not-unique' | 'invalid-input', reason: string): never => { throw thrown({ type, reason }) }

  function place(impl: Implementation, w: Where) {
    if (Object.hasOwn(d.pods, w.pod)) fail('invalid-input', `pod ${w.pod} is already in the deployment`)
    d.pods[w.pod] = { implementation: impl.coord, eager: w.eager ?? false }
    runtime(w.in).pods.push(w.pod)
  }

  function handle(at: string, pod: string, api: Interface): Handle {
    return { runtime: at, pod, implementation: d.pods[pod]!.implementation, create(impl, w) {
      place(impl, w)
      const r = runtime(at)
      r.subscriptions.push({ kind: 'call', from: w.pod, to: pod })
      if (r.policy?.kind === 'rules')
        r.policy.rules.unshift({ allow: ['call', 'subscribe'], from: w.pod, outside: !r.pods.includes(w.pod), toInterface: api.coord })
      const own = impl.provides[0]
      return own ? handle(w.in, w.pod, own) : fail('invalid-input', `${impl.coord} provides no interface`)
    } }
  }

  function resolve(at: string, api: Interface): Handle {
    const found = (d.runtimes[at]?.pods ?? []).filter(p => registry.implementation(d.pods[p]?.implementation ?? '')?.provides.some(i => i.coord === api.coord))
    if (found.length === 0) return fail('not-found', `no pod provides ${api.coord} in ${at}`)
    if (found.length > 1) return fail('not-unique', `${found.length} pods provide ${api.coord} in ${at}`)
    return handle(at, found[0]!, api)
  }

  const same = (a: PipeEnds, s: { kind: string } & Partial<PipeEnds>) => s.kind === 'pipe' && s.from === a.from && s.source === a.source && s.to === a.to && s.target === a.target

  function pipe(at: string, p: PipeEnds) {
    const r = d.runtimes[at]
    if (!r) return fail('not-found', `no runtime ${at}`)
    for (const pod of [p.from, p.to]) if (!r.pods.includes(pod)) fail('not-found', `${pod} is not placed in ${at}`)
    if (r.subscriptions.some(s => same(p, s))) fail('invalid-input', `${p.from} ${p.source} is already piped to ${p.to} ${p.target} in ${at}`)
    r.subscriptions.push({ kind: 'pipe', ...p })
  }

  function unpipe(at: string, p: PipeEnds) {
    const r = d.runtimes[at], i = r ? r.subscriptions.findIndex(s => same(p, s)) : -1
    if (!r || i < 0) return fail('not-found', `no such pipe in ${at}`)
    r.subscriptions.splice(i, 1)
  }

  return { place, resolve, pipe, unpipe, deployment: (): AppDeployment => structuredClone(d) }
}
