// A nano.json document onto the live app, in the spec's order: title, theme, profile; imports (awaited); systems;
// instances (deployed with mode and guard selectors, then `configure`); subscriptions; workspaces and their layouts.
// 'replace' is for a freshly started host (Open reloads first): it replaces the stores. 'merge' (Import) adds only
// what is new and leaves title, theme and profile alone. Both skip what clashes, with a note; nothing throws.
import { Ops, type Runtime } from '@pritzlaff/nano-core'
import { PlatformOps as P, runtimeOf } from '@composable/platform'
import { Profile, RESERVED, type NanoApp } from '@composable/shell'
import { isThemeId } from '../lib/themes.ts'
import { ICONS } from '../lib/saved-workspaces.ts'
import type { AppCatalog } from '../sandbox/deploy.ts'
import { MAIN, value, type Stores } from './snapshot.ts'

export interface ApplyDeps {
  host: Runtime
  stores: Stores
  /** Loads a package; a name and version, when known, are kept with the import. */
  importPackage(url: string, trust: 'trusted' | 'sandboxed'): Promise<{ error?: string; name?: string; version?: string }>
  /** The host's catalog, for which kinds take code (read at call time: imports add to it). */
  catalog: AppCatalog
  /** Whether an instance's code (map, filter: its config, and subscriptions into setCode/configure) may run: false for a document unless the person agreed. */
  consentCode?(system: string, instance: string): boolean
  /** Longest waits in ms for one configure and one import (a sandbox frame may never answer). */
  waits?: { configure?: number; import?: number }
}

const within = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => {
  let t: unknown
  return Promise.race([p, new Promise<never>((_, no) => { t = setTimeout(() => no(new Error(`${what} timed out after ${ms / 1000} s`)), ms) })]).finally(() => clearTimeout(t as never))
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Never throws or hangs for long: every failure is a note. */
export async function applyApp(app: NanoApp, how: 'replace' | 'merge', deps: ApplyDeps): Promise<string[]> {
  const notes: string[] = []
  try { await apply(app, how, deps, notes) } catch (e) { notes.push(`stopped: ${msg(e)}`) }
  return notes
}

async function apply(app: NanoApp, how: 'replace' | 'merge', deps: ApplyDeps, notes: string[]): Promise<void> {
  const { host, stores } = deps, from = { registry: host.registry.id, instance: 'app' }
  const call = async (target: string, op: { ns: string; name: string }, arg: unknown) => {
    try { return await host.call(from, target, Ops.key(op), arg) } catch (e) { return { error: msg(e) } }
  }
  const attempt = (what: string, f: () => void) => { try { f() } catch (e) { notes.push(`${what}: ${msg(e)}`) } }
  const consent = (system: string, instance: string) => { try { return !!deps.consentCode?.(system, instance) } catch { return false } }
  const fail = (what: string, r: { error: string }) => notes.push(`${what}: ${r.error}`)
  const replace = how === 'replace'

  if (replace) {
    attempt('title', () => stores.title.set(app.title))
    if (app.theme) {
      if (isThemeId(app.theme.id)) { const t = app.theme; attempt('theme', () => stores.theme.set({ theme: t.id as never, mode: t.mode ?? stores.theme.get().mode })) }
      else notes.push(`unknown theme ${app.theme.id}: kept the host's`)
    }
    if (app.profile) {
      const u = await call('profile', Profile.ops.setUser, app.profile.user); if ('error' in u) fail('profile', u)
      else { const e = await call('profile', Profile.ops.setEntries, app.profile.entries); if ('error' in e) fail('profile entries', e) }
    }
  }

  // imports, in order; a failed one is a note and its kinds are skipped below
  const have = new Map(stores.imports.list().map(r => [r.url, r]))
  const imports = replace ? [] : [...have.values()]
  for (const i of app.imports) {
    if (have.has(i.url)) { if (replace) imports.push(have.get(i.url)!); else notes.push(`import ${i.url} is already there`); continue }
    const r = await within(deps.importPackage(i.url, i.trust), deps.waits?.import ?? 15_000, 'import').catch((e: unknown) => ({ error: msg(e) } as { error?: string; name?: string; version?: string }))
    if (r.error) notes.push(`import ${i.url}: ${r.error}`)
    else imports.push({ url: i.url, name: r.name ?? i.url, version: r.version ?? '', trust: i.trust })
  }
  attempt('imports', () => stores.imports.set(imports))

  const kinds = ((await value(host, from, 'platform', Ops.key(P.kinds))) ?? []) as { kind: string; component: string; modes?: string[] }[]
  const kindBy = new Map(kinds.map(k => [k.kind, k]))
  const codeOps = (kind: string | undefined) => (kind !== undefined && Object.hasOwn(deps.catalog, kind) ? deps.catalog[kind]!.code : undefined)
  const kindOfComponent = new Map(kinds.map(k => [k.component, k.kind]))
  // the systems there are, fetched once and kept current
  const existing = new Set((((await value(host, from, 'platform', Ops.key(P.systems))) ?? []) as { id: string }[]).map(s => s.id))

  const ok = new Set<string>()   // systems that exist
  for (const sys of app.systems) {
    if (!existing.has(sys.id)) {
      const r = await call('platform', P.createSystem, sys.id)
      if ('error' in r) { fail(`system ${sys.id}`, r); continue }
      existing.add(sys.id)
    }
    ok.add(sys.id)
    const rt = sys.id === host.registry.id ? host : runtimeOf(host.registry, sys.id)
    if (!rt) { notes.push(`system ${sys.id}: no runtime`); continue }
    for (const i of sys.instances) {
      const what = `${sys.id}/${i.id}`
      if (RESERVED(i.id)) { notes.push(`${what}: ${i.id} is reserved by the host, skipped`); continue }
      const k = kindBy.get(i.kind)
      if (!k) { notes.push(`${what}: no component kind ${i.kind}, skipped`); continue }
      if (rt.registry.get(i.id)) { notes.push(`${what}: already exists, skipped`); continue }
      let mode = i.mode
      if (mode && k.modes && !k.modes.includes(mode) && k.modes.includes('isolated-sandbox')) {
        notes.push(`${what}: ${i.kind} is sandboxed, deployed isolated-sandbox instead of ${mode}`); mode = 'isolated-sandbox'
      }
      const made = await call('platform', P.createComponent, { kind: i.kind, name: i.id, system: sys.id, ...(mode && { mode }), ...(i.allow && { allow: i.allow }), ...(i.deny && { deny: i.deny }) })
      if ('error' in made) { fail(what, made); continue }
      if (i.config === undefined) continue
      if (codeOps(i.kind) && !consent(sys.id, i.id)) { notes.push(`${what}: its ${i.kind} code was not applied (not agreed to)`); continue }
      const c = await within(rt.call(from, i.id, `${k.component}/configure`, i.config), deps.waits?.configure ?? 5000, 'configure').catch((e: unknown) => ({ error: msg(e) }))
      if ('error' in c) fail(`${what} configure`, c)
    }
  }

  for (const sys of app.systems) {
    const rt = ok.has(sys.id) ? (sys.id === host.registry.id ? host : runtimeOf(host.registry, sys.id)) : undefined
    if (!rt) { if (sys.subscriptions.length) notes.push(`system ${sys.id}: its subscriptions were skipped`); continue }
    for (const s of sys.subscriptions) {
      const what = `${sys.id}: ${s.source} ${s.op} -> ${s.listener} ${s.target}`
      const missing = [s.source === '*' ? undefined : s.source, s.listener].find(x => x !== undefined && !rt.registry.get(x))
      if (missing) { notes.push(`${what}: ${missing} is not there, skipped`); continue }
      // a subscription into a code-taking op (setCode, configure) would feed the document's data to code: needs the same consent
      const lc = rt.registry.snapshot().instances.find(x => x.id === s.listener)?.component, ops = codeOps(lc === undefined ? undefined : kindOfComponent.get(lc))
      if (ops?.some(o => s.target === `${lc}/${o}`) && !consent(sys.id, s.listener)) { notes.push(`${what}: it feeds code and was not applied (not agreed to)`); continue }
      if (rt.registry.snapshot().subscriptions.some(x => x.source === s.source && x.op === s.op && x.listener === s.listener && x.target === s.target)) { notes.push(`${what}: already wired, skipped`); continue }
      // the platform's connect needs a named source; a '*' one goes straight to the registry
      const r = s.source === '*' ? rt.registry.subscribe(s) : await call('platform', P.connect, { system: sys.id, ...s })
      if ('error' in r) fail(what, r)
    }
  }

  const saved = replace ? [] : [...stores.workspaces.list()]
  const layouts: [string, unknown][] = []
  for (const w of app.workspaces) {
    if (w.id === MAIN) { notes.push(`workspace ${w.id} is the host's own, skipped`); continue }
    if (saved.some(x => x.path === w.id)) { notes.push(`workspace ${w.id} already exists, skipped`); continue }
    // a workspace whose system doesn't exist is still saved (its page then falls back to the host's system when mounted, by Task 5)
    if (!existing.has(w.system)) notes.push(`workspace ${w.id}: system ${w.system} does not exist`)
    saved.push({ path: w.id, title: w.title, icon: w.icon && Object.hasOwn(ICONS, w.icon) ? w.icon : 'folder', system: w.system })
    if (w.layout !== null && w.layout !== undefined) layouts.push([w.id, w.layout])
  }
  attempt('workspaces', () => stores.workspaces.set(saved))
  for (const [path, layout] of layouts) attempt(`layout of ${path}`, () => stores.layouts.set(path, layout))
}
