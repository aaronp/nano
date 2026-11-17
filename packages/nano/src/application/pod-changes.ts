/**
 * Pod changes: after an apply, each pod listening (`ctx.addOnPodChangeListener`) hears the other pods added to or
 * removed from the runtimes it is placed in, if that runtime's policy allows `'lifecycle'`.
 *
 *   await notifyPodChanges(live, before)   // `before`: the deployment the apply replaced; `live.now()` is the new one
 */
import type { AppDeployment } from '../deployment.ts'
import { attempt, refusal, type Live } from './messages.ts'

export async function notifyPodChanges(live: Live, before: AppDeployment): Promise<void> {
  const after = live.now(), told = new Set<unknown>()
  for (const id of new Set([...Object.keys(before.runtimes), ...Object.keys(after.runtimes)])) {
    const was = before.runtimes[id]?.pods ?? [], is = after.runtimes[id]?.pods ?? []
    const changes = [...is.filter(p => !was.includes(p)).map(p => ({ type: 'added' as const, p, d: after })),
      ...was.filter(p => !is.includes(p)).map(p => ({ type: 'removed' as const, p, d: before }))]
    for (const l of [...live.listeners.podChanges]) {
      if (!is.includes(l.pod)) continue
      for (const c of changes) {
        if (c.p === l.pod) continue
        const why = refusal(live, { runtime: id, kind: 'lifecycle', from: l.pod, to: c.p })
        if (why !== undefined) {
          if (!told.has(l)) { told.add(l); live.trace.emit({ type: 'denied', id: live.trace.id(), reason: why }) }   // once per listener per apply
          continue
        }
        const implementation = live.registry.implementation(c.d.pods[c.p]?.implementation ?? '')?.coord ?? ''
        const p = attempt(live, l.pod, `${l.pod} hearing ${c.type} ${c.p}`, () => l.fn({ type: c.type, runtime: id, pod: c.p, implementation }))
        const done = () => { live.flying.delete(p) }   // in flight, not awaited: a callback may itself apply or restart
        live.flying.add(p); p.then(done, done)
      }
    }
  }
}
