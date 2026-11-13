// The live app as a nano.json document (see apply.ts for the reverse). Reads the Application's systems, the instances'
// labels and `config`s, its screens and tags, and the host's stores; writes nothing. Pure: it talks to the host through a runtime.
import { Ops, type Runtime } from '@pritzlaff/nano-core'
import { ApplicationOps as P, runtimeOf, type Screen } from './application'
import { HOST_DRIVEN, RESERVED, type NanoApp } from './document'
import type { Selector } from './resolve'

/** The runtime the Application lives in: a handle to call it through. */
export type AppHandle = Runtime

type Entry = { label: string; href: string }
// the host's profile component (nano.shell/profile): its ops by key, as nano-app cannot import it
export const PROFILE = { user: 'nano.shell/profile/user', entries: 'nano.shell/profile/entries', setUser: 'nano.shell/profile/setUser', setEntries: 'nano.shell/profile/setEntries' }

/** The host's stores, as far as a document needs them; tests pass fakes. `set` replaces the whole list. */
export interface HostStores {
  imports: { list(): { url: string; name: string; version: string; trust?: 'trusted' | 'sandboxed' }[]; set(xs: { url: string; name: string; version: string; trust?: 'trusted' | 'sandboxed' }[]): void }
  theme: { get(): { theme: string; mode: 'system' | 'light' | 'dark' }; set(c: { theme: string; mode: 'system' | 'light' | 'dark' }): void }
  title: { get(): string; set(t: string): void }
  /** Profile menu links to the host's own pages: always in the menu after a document's own entries, never written to one. */
  hostEntries?: readonly Entry[]
}

const me = (host: Runtime) => ({ registry: host.registry.id, instance: 'app' })
const CONFIG_WAIT = 2000   // a hung sandbox frame must not hang a snapshot

/** Calls an op, giving its value, or undefined on any error (or a wait over `ms`). */
export async function value(rt: Runtime, from: { registry: string; instance: string }, target: string, op: string, arg: unknown = null, ms = CONFIG_WAIT): Promise<unknown> {
  let timer: unknown
  try {
    const r = await Promise.race([rt.call(from, target, op, arg), new Promise<undefined>(res => { timer = setTimeout(res, ms) })])
    return r && 'value' in r ? r.value : undefined
  } catch { return undefined } finally { clearTimeout(timer as never) }
}
const list = (s: string | undefined): string[] | undefined => {
  try { const v = s === undefined ? undefined : JSON.parse(s); return Array.isArray(v) && v.every(x => typeof x === 'string') ? v : undefined } catch { return undefined }
}

export async function snapshotApp(host: AppHandle, stores: HostStores): Promise<NanoApp> {
  const from = me(host)
  const kinds = ((await value(host, from, 'application', Ops.key(P.kinds))) ?? []) as { kind: string; component: string }[]
  const kindOf = new Map<string, string>()
  for (const k of kinds) if (!kindOf.has(k.component)) kindOf.set(k.component, k.kind)
  const snaps = ((await value(host, from, 'application', Ops.key(P.systems))) ?? []) as ReturnType<Runtime['registry']['snapshot']>[]

  const systems: NanoApp['systems'] = []
  for (const snap of snaps) {
    const rt = snap.id === host.registry.id ? host : runtimeOf(host.registry, snap.id)
    const viewOwned = new Set(snap.instances.filter(i => i.owner?.kind === 'view').map(i => i.id))
    const live = new Set(snap.instances.map(i => i.id))
    // each instance's config is read at once: N hung frames cost one wait, not N
    const found = await Promise.all(snap.instances.map(async i => {
      const kind = kindOf.get(i.component)
      if (RESERVED(i.id) || viewOwned.has(i.id) || !kind) return undefined   // the host's own, a view's listener, or something no kind can recreate
      const l = i.labels ?? {}, mode = l['nano/deploy'], allow = list(l['nano/allow']), deny = list(l['nano/deny'])
      const hasConfig = i.ops.some(o => Ops.key(o) === `${i.component}/config`)
      const config = hasConfig && rt ? await value(rt, from, i.id, `${i.component}/config`) : undefined
      // each need as a pin to what it is bound to, or (unbound) as its stored selector
      const declared = Object.keys(i.needs ?? {}).length ? ((await value(host, from, 'application', Ops.key(P.needsOf), `instance:${snap.id}/${i.id}`)) ?? []) as { need: string; selector: Selector }[] : []
      const needs = Object.fromEntries(declared.map(({ need, selector }) => {
        const to = snap.bindings.find(b => b.instance === i.id && b.need === need)?.to
        return [need, to ? { implements: selector.implements, ...(selector.tags?.length && { tags: selector.tags }), layer: to.registry, at: to.instance } : selector]
      }))
      return { id: i.id, kind, ...(mode === 'host' || mode === 'sandbox' || mode === 'isolated-sandbox' ? { mode } : {}),
        ...(allow && { allow }), ...(deny && { deny }), ...(config !== undefined && { config }), ...(declared.length && { needs }) } as NanoApp['systems'][number]['instances'][number]
    }))
    const instances = found.filter(x => x !== undefined)
    const written = new Set(instances.map(i => i.id))
    const known = (x: string) => written.has(x) || (RESERVED(x) && live.has(x))
    const subscriptions = snap.subscriptions
      .filter(s => !HOST_DRIVEN(s.listener) && !viewOwned.has(s.listener) && !viewOwned.has(s.source) && (s.source === '*' || known(s.source)) && known(s.listener) && (written.has(s.source) || written.has(s.listener)))
      .map(s => ({ source: s.source, op: s.op, listener: s.listener, target: s.target }))
    if (snap.id === host.registry.id && !instances.length && !subscriptions.length) continue   // the host's own built-ins only
    systems.push({ id: snap.id, instances, subscriptions })
  }

  const screens = ((await value(host, from, 'application', Ops.key(P.screens))) ?? []) as Screen[]
  const workspaces = screens.map(s => ({ id: s.id, title: s.title, system: s.system, ...(s.icon && { icon: s.icon }), layout: s.layout ?? null }))
  // tags, for what the document keeps: not an instance it leaves out
  const allTags = ((await value(host, from, 'application', Ops.key(P.allTags))) ?? {}) as Record<string, string[]>
  const keptRefs = new Set([...systems.flatMap(sy => sy.instances.map(i => `instance:${sy.id}/${i.id}`)), ...workspaces.map(w => `screen:${w.id}`), ...snaps.map(sn => `system:${sn.id}`)])
  const tags = Object.fromEntries(Object.entries(allTags).filter(([r, ts]) => keptRefs.has(r) && ts.length))
  const user = await value(host, from, 'profile', PROFILE.user) as { name: string; avatar?: string } | undefined
  const entries = await value(host, from, 'profile', PROFILE.entries) as { label: string; href: string }[] | undefined
  const t = stores.theme.get(), hostEntries = stores.hostEntries ?? []
  return {
    nano: 1, title: stores.title.get(), theme: { id: t.theme, mode: t.mode },
    ...(user && entries && { profile: { user: { name: user.name, ...(user.avatar !== undefined && { avatar: user.avatar }) }, entries: entries.filter(e => !hostEntries.some(h => h.href === e.href)).map(e => ({ label: e.label, href: e.href })) } }),
    imports: stores.imports.list().map(r => ({ url: r.url, trust: r.trust ?? 'trusted' })),
    systems, workspaces, ...(Object.keys(tags).length && { tags }),
  }
}
