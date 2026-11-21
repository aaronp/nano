/**
 * A deploy and a pick (spec §3). `deploy` places a lazy pod of an implementation in a runtime (ADR-0035: the page
 * showing it starts it), named `<kind><n>` with the first free n, configured with its config schema's `default` (when it
 * declares one), with a rule letting the host reach it when the runtime's policy is `rules`, and its dependencies
 * connected (`connect`): its name and `connect`'s notes, and no slot. A pick is a deploy, then its `pod` slot added to the page. Deploys run one
 * at a time, so no two take one name. A pick whose deploy fails adds no slot; a page removed while its pod deploys leaves
 * the pod deployed and shown nowhere (`not-found`).
 *
 *   const { deploy, pick } = picker(app, registry, outline)
 *   await deploy('nano.ui/log', 'main')         // success({ name: 'log1', notes: [] }): the pod's name, connect's notes
 *   await pick('home', 'nano.ui/log', 'main')   // success('log2'): the new slot's id
 */
import { AppDeployment, Coord, failure, success, type Application, type NanoResult, type Registry } from '@pritzlaff/nano-core'
import { connect } from './connect.ts'
import { addSlot } from './edits.ts'
import type { live } from './outline-live.ts'

export function picker(app: Application, registry: Registry, outline: ReturnType<typeof live>) {
  async function place(implementation: string, runtime: string): Promise<NanoResult<{ name: string; notes: string[] }>> {
    const found = registry.implementation(implementation), kind = implementation.slice(implementation.indexOf('/') + 1)
    if (!found) return failure('not-found', `no implementation ${implementation}`)
    const d = app.deployment()
    let n = 1
    while (`${kind}${n}` in d.pods) n++
    const name = `${kind}${n}`, e = AppDeployment.edit(d, registry)
    e.place(found, { pod: name, in: runtime })
    const out = e.deployment(), r = out.runtimes[runtime]!
    const start = (found.config as { default?: unknown } | undefined)?.default
    if (start !== undefined) out.pods[name]!.config = structuredClone(start)
    if (r.policy?.kind === 'rules') r.policy.rules.unshift({ allow: ['call', 'subscribe', 'start'], from: 'host', outside: true, toPod: name })
    const { deployment, notes } = connect(out, registry, [name]), applied = await app.apply(deployment)
    return applied.ok ? success({ name, notes }) : applied
  }
  let queue: Promise<unknown> = Promise.resolve()
  const deploy = (implementation: string, runtime: string): Promise<NanoResult<{ name: string; notes: string[] }>> => {
    const run = queue.then(() => place(implementation, runtime))
    queue = run.catch(() => {})
    return run
  }
  async function pick(page: string, implementation: string, runtime: string): Promise<NanoResult<string>> {
    if (!outline.document().doc.pages[page]) return failure('not-found', `no page ${page}`)
    const placed = await deploy(implementation, runtime)
    if (!placed.ok) return placed
    const { name } = placed.value, at = outline.document().doc
    const next = addSlot(at, page, { kind: 'pod', pod: Coord.pod(Coord.parse('implementation', registry.implementation(implementation)!.coord), Coord.runtime(runtime), name) })
    if (!next) return failure('not-found', `no page ${page}: pod ${name} deployed, shown nowhere`)   // removed while the pod deployed
    const added = Object.keys(next.pages[page]!.slots).find(s => !Object.hasOwn(at.pages[page]!.slots, s))!, done = outline.apply(next)
    return done.ok ? success(added) : done
  }
  return { deploy, pick }
}
