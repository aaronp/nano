/**
 * A pick (spec §3): a lazy pod of an implementation deployed into a runtime (ADR-0035: the page showing it starts it),
 * named `<kind><n>` with the first free n, with its starting config, a rule letting the host reach it when the runtime's
 * policy is `rules`, and its dependencies connected (connect.ts); then its `pod` slot added to the page. Picks run one
 * at a time, so no two take one name. A pick whose deploy fails adds no slot.
 *
 *   const pick = picker(app, registry, outline)
 *   await pick('home', 'nano.ui/log', 'main')   // success('log1'): the new slot's id
 */
import { AppDeployment, Coord, failure, success, type Application, type NanoResult, type Registry } from '@pritzlaff/nano-core'
import { connect } from './connect.ts'
import { addSlot } from './edits.ts'
import type { live } from './outline-live.ts'

// ponytail: one implementation needs a config to start; a default config declared by implementations would replace this table
const starts: Record<string, unknown> = { 'nano.ui/map': { code: 'return x' } }

export function picker(app: Application, registry: Registry, outline: ReturnType<typeof live>) {
  async function make(page: string, implementation: string, runtime: string): Promise<NanoResult<string>> {
    const found = registry.implementation(implementation), kind = implementation.slice(implementation.indexOf('/') + 1)
    if (!found) return failure('not-found', `no implementation ${implementation}`)
    if (!outline.document().doc.pages[page]) return failure('not-found', `no page ${page}`)
    const d = app.deployment()
    let n = 1
    while (`${kind}${n}` in d.pods) n++
    const name = `${kind}${n}`, e = AppDeployment.edit(d, registry)
    e.place(found, { pod: name, in: runtime })
    const out = e.deployment(), r = out.runtimes[runtime]!
    if (starts[implementation] !== undefined) out.pods[name]!.config = starts[implementation]
    if (r.policy?.kind === 'rules') r.policy.rules.unshift({ allow: ['call', 'subscribe', 'start'], from: 'host', outside: true, toPod: name })
    const applied = await app.apply(connect(out, registry, name))
    if (!applied.ok) return applied
    const at = outline.document().doc, next = addSlot(at, page, { kind: 'pod', pod: Coord.pod(Coord.parse('implementation', found.coord), Coord.runtime(runtime), name) })
    if (!next) return failure('not-found', `no page ${page}`)   // removed while the pod deployed
    const done = outline.apply(next)
    return done.ok ? success(Object.keys(next.pages[page]!.slots).at(-1)!) : done
  }
  let queue: Promise<unknown> = Promise.resolve()
  return (page: string, implementation: string, runtime: string): Promise<NanoResult<string>> => {
    const run = queue.then(() => make(page, implementation, runtime))
    queue = run.catch(() => {})
    return run
  }
}
