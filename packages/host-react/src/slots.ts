/**
 * Page edits, each one `platform.apply`: add a slot (deploy a lazy pod, then apply its `pod` slot), remove a slot, add a
 * page (its `title`), set a page's columns (`layout.react`, ADR-0039: the other clients' keys kept as they are).
 *
 *   await addSlot(h, 'workspace', 'nano.ui/log', 'main')   // success('log1')
 */
import { AppDeployment, Coord, failure, success, type NanoResult } from '@pritzlaff/nano-core'
import type { Page } from '@pritzlaff/nano-platform'
import type { Host } from './boot.ts'
import { connect } from './connect.ts'

/** The config an implementation needs to start, where it needs one. */
const starts: Record<string, unknown> = { 'nano.ui/map': { code: 'return x' } }
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const free = (base: string, taken: (id: string) => boolean) => { let id = base; for (let n = 2; taken(id); n++) id = `${base}-${n}`; return id }

/** Page `id` replaced by `f` of it, applied. */
function edit(h: Host, id: string, f: (p: Page) => Page): NanoResult<void> {
  const d = h.platform.document().doc, p = d.pages[id]
  return p ? h.platform.apply({ pages: { ...d.pages, [id]: f(p) } }) : failure('not-found', `no page ${id}`)
}

/** One add at a time, so no two take one name. */
let adding: Promise<unknown> = Promise.resolve()
export function addSlot(h: Host, page: string, impl: string, runtime: string): Promise<NanoResult<string>> {
  const run = adding.then(() => make(h, page, impl, runtime))
  adding = run.catch(() => {})
  return run
}
async function make(h: Host, page: string, impl: string, runtime: string): Promise<NanoResult<string>> {
  const d = h.saved(), found = h.registry.implementation(impl), kind = impl.slice(impl.indexOf('/') + 1)
  if (!found) return failure('not-found', `no implementation ${impl}`)
  let n = 1
  while (`${kind}${n}` in d.pods) n++
  const name = `${kind}${n}`, e = AppDeployment.edit(d, h.registry)
  e.place(found, { pod: name, in: runtime })
  const out = e.deployment(), r = out.runtimes[runtime]!
  if (starts[impl] !== undefined) out.pods[name]!.config = starts[impl]
  if (r.policy?.kind === 'rules') r.policy.rules.unshift({ allow: ['call', 'subscribe', 'start'], from: 'host', outside: true, toPod: name })
  const applied = await h.app.apply(connect(out, h.registry, name))
  if (!applied.ok) return applied
  const pod = Coord.pod(Coord.parse('implementation', impl), Coord.runtime(runtime), name)
  let sid = name
  const done = edit(h, page, p => { sid = free(name, s => Object.hasOwn(p.slots, s)); return { ...p, slots: { ...p.slots, [sid]: { kind: 'pod', pod } } } })
  return done.ok ? success(sid) : done
}

export const removeSlot = (h: Host, page: string, slot: string) => edit(h, page, ({ slots: { [slot]: _, ...rest }, ...p }) => ({ ...p, slots: rest }))

/** A new empty page titled `title`; its id from the title. */
export function addPage(h: Host, title: string): NanoResult<string> {
  const pages = h.platform.document().doc.pages
  const id = free(title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page', s => s in pages)
  const r = h.platform.apply({ pages: { ...pages, [id]: { slots: {}, title } } })
  return r.ok ? success(id) : r
}

export const titleOf = (id: string, p: Page | undefined) => p?.title ?? id
export const columnsOf = (p: Page | undefined) => {
  const c = obj(p?.layout) && obj(p.layout['react']) ? p.layout['react']['columns'] : undefined
  return typeof c === 'number' && c >= 1 ? c : 2
}

/** Page `id`'s columns in `layout.react`. */
export const setColumns = (h: Host, id: string, columns: number): NanoResult<void> =>
  edit(h, id, p => ({ ...p, layout: { ...(obj(p.layout) ? p.layout : {}), react: { columns } } }))
