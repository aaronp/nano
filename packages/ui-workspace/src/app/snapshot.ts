// The live app as a nano.json document (see apply.ts for the reverse). Reads the platform's systems, the instances'
// labels and `config`s, and the host's stores; writes nothing.
import { Ops, type Runtime } from '@pritzlaff/nano-core'
import { PlatformOps as P, runtimeOf } from '@composable/platform'
import { Profile, RESERVED, type NanoApp } from '@composable/shell'
import type { ThemeChoice } from '../lib/theme-state.ts'
import type { ImportRecord } from '../lib/imports.ts'
import type { SavedWorkspace } from '../lib/saved-workspaces.ts'

/** The profile menu's links to the host's own pages: always in the menu after a document's own entries, never written to one. */
export const HOST_ENTRIES = [{ label: 'Components', href: '#/components' }, { label: 'Settings', href: '#/settings' }, { label: 'Systems', href: '#/systems' }, { label: 'Themes', href: '#/themes' }]

/** The host's stores, as far as a document needs them; tests pass fakes. `set` replaces the whole list. */
export interface Stores {
  imports: { list(): ImportRecord[]; set(xs: ImportRecord[]): void }
  workspaces: { list(): SavedWorkspace[]; set(xs: SavedWorkspace[]): void }
  /** A saved workspace's dock layout (null when it has none yet), by its path. */
  layouts: { get(path: string): unknown; set(path: string, layout: unknown): void }
  theme: { get(): ThemeChoice; set(c: ThemeChoice): void }
  title: { get(): string; set(t: string): void }
}

export const MAIN = '/workspace'
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

export async function snapshotApp({ host, stores }: { host: Runtime; stores: Stores }): Promise<NanoApp> {
  const from = me(host)
  const kinds = ((await value(host, from, 'platform', Ops.key(P.kinds))) ?? []) as { kind: string; component: string }[]
  const kindOf = new Map<string, string>()
  for (const k of kinds) if (!kindOf.has(k.component)) kindOf.set(k.component, k.kind)
  const snaps = ((await value(host, from, 'platform', Ops.key(P.systems))) ?? []) as ReturnType<Runtime['registry']['snapshot']>[]

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
      return { id: i.id, kind, ...(mode === 'host' || mode === 'sandbox' || mode === 'isolated-sandbox' ? { mode } : {}),
        ...(allow && { allow }), ...(deny && { deny }), ...(config !== undefined && { config }) } as NanoApp['systems'][number]['instances'][number]
    }))
    const instances = found.filter(x => x !== undefined)
    const written = new Set(instances.map(i => i.id))
    const known = (x: string) => written.has(x) || (RESERVED(x) && live.has(x))
    const subscriptions = snap.subscriptions
      .filter(s => !viewOwned.has(s.listener) && !viewOwned.has(s.source) && (s.source === '*' || known(s.source)) && known(s.listener) && (written.has(s.source) || written.has(s.listener)))
      .map(s => ({ source: s.source, op: s.op, listener: s.listener, target: s.target }))
    if (snap.id === host.registry.id && !instances.length && !subscriptions.length) continue   // the host's own built-ins only
    systems.push({ id: snap.id, instances, subscriptions })
  }

  const ws = stores.workspaces.list().filter(w => w.path !== MAIN)
  const workspaces = ws.map(w => ({ id: w.path, title: w.title, system: w.system ?? 'host', icon: w.icon, layout: stores.layouts.get(w.path) ?? null }))
  const user = await value(host, from, 'profile', Ops.key(Profile.ops.user)) as { name: string; avatar?: string } | undefined
  const entries = await value(host, from, 'profile', Ops.key(Profile.ops.entries)) as { label: string; href: string }[] | undefined
  const t = stores.theme.get()
  return {
    nano: 1, title: stores.title.get(), theme: { id: t.theme, mode: t.mode },
    ...(user && entries && { profile: { user: { name: user.name, ...(user.avatar !== undefined && { avatar: user.avatar }) }, entries: entries.filter(e => !HOST_ENTRIES.some(h => h.href === e.href)).map(e => ({ label: e.label, href: e.href })) } }),
    imports: stores.imports.list().map(r => ({ url: r.url, trust: r.trust ?? 'trusted' })),
    systems, workspaces,
  }
}
