// A nano.json document onto the live app, in the spec's order: title, theme, profile; imports (awaited); systems;
// instances (deployed with mode and guard selectors, then `configure`); subscriptions; workspaces and their layouts
// (the application's screens). 'replace' is for a freshly started host (Open reloads first): it replaces the stores
// and the screens but Main. 'merge' (Import) adds only what is new and leaves title, theme and profile alone. Both skip what clashes, with a note; nothing throws.
import { Ops, type Runtime } from '@pritzlaff/nano-core'
import { ApplicationOps as P, runtimeOf, type Screen } from './application'
import type { AppCatalog } from './catalog'
import { HOST_DRIVEN, MAIN, RESERVED, type NanoApp } from './document'
import { parseRef } from './refs'
import type { Resolution, Selector } from './resolve'
import { PROFILE, value, type HostStores } from './snapshot'

export interface ApplyDeps {
  host: Runtime
  stores: HostStores
  /** Loads a package; a name and version, when known, are kept with the import. */
  importPackage(url: string, trust: 'trusted' | 'sandboxed'): Promise<{ error?: string; name?: string; version?: string }>
  /** The host's catalog, for which kinds take code (read at call time: imports add to it). */
  catalog: AppCatalog
  /** Whether an instance's code (map, filter: its config, and subscriptions into setCode/configure) may run: false for a document unless the person agreed. */
  consentCode?(system: string, instance: string): boolean
  /** Longest waits in ms for one configure and one import (a sandbox frame may never answer). */
  waits?: { configure?: number; import?: number }
  /** Whether the host knows a theme id / an icon name (an unknown icon becomes 'folder'). Required: a host must say. */
  known: { theme(id: string): boolean; icon(name: string): boolean }
}

const within = <T>(p: Promise<T>, ms: number, what: string): Promise<T> => {
  let t: unknown
  return Promise.race([p, new Promise<never>((_, no) => { t = setTimeout(() => no(new Error(`${what} timed out after ${ms / 1000} s`)), ms) })]).finally(() => clearTimeout(t as never))
}
/** Whether `target` (ns/name/op) is a code-taking op of `kind`: the one match for what needs consent. */
export const codeTarget = (catalog: AppCatalog, kind: string | undefined, target: string): boolean => {
  const e = kind !== undefined && Object.hasOwn(catalog, kind) ? catalog[kind]! : undefined
  return !!e?.code?.some(o => target === `${e.component.id.ns}/${e.component.id.name}/${o}`)
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
  const callKey = async (target: string, key: string, arg: unknown) => {
    try { return await host.call(from, target, key, arg) } catch (e) { return { error: msg(e) } }
  }
  const call = (target: string, op: { ns: string; name: string }, arg: unknown) => callKey(target, Ops.key(op), arg)
  const attempt = (what: string, f: () => void) => { try { f() } catch (e) { notes.push(`${what}: ${msg(e)}`) } }
  const consent = (system: string, instance: string) => { try { return !!deps.consentCode?.(system, instance) } catch { return false } }
  const fail = (what: string, r: { error: string }) => notes.push(`${what}: ${r.error}`)
  const replace = how === 'replace'

  if (replace) {
    attempt('title', () => stores.title.set(app.title))
    if (app.theme) {
      if (deps.known.theme(app.theme.id)) { const t = app.theme; attempt('theme', () => stores.theme.set({ theme: t.id, mode: t.mode ?? stores.theme.get().mode })) }
      else notes.push(`unknown theme ${app.theme.id}: kept the host's`)
    }
    if (app.profile) {
      const u = await callKey('profile', PROFILE.setUser, app.profile.user); if ('error' in u) fail('profile', u)
      else { const e = await callKey('profile', PROFILE.setEntries, [...app.profile.entries, ...(stores.hostEntries ?? []).filter(h => !app.profile!.entries.some(e => e.href === h.href))]); if ('error' in e) fail('profile entries', e) }
    }
  }

  // imports, in order; a failed one is a note and its kinds are skipped below
  const have = new Map(stores.imports.list().map(r => [r.url, r]))
  const imports = replace ? [] : [...have.values()]
  // loaded in parallel (each bounded by its own wait), recorded in the document's order
  const loaded = await Promise.all(app.imports.map(i => have.has(i.url) ? undefined
    : within(deps.importPackage(i.url, i.trust), deps.waits?.import ?? 15_000, 'import').catch((e: unknown) => ({ error: msg(e) } as { error?: string; name?: string; version?: string }))))
  for (const [n, i] of app.imports.entries()) {
    if (have.has(i.url)) { if (replace) imports.push(have.get(i.url)!); else notes.push(`import ${i.url} is already there`); continue }
    const r = loaded[n]!
    if (r.error) notes.push(`import ${i.url}: ${r.error}`)
    else imports.push({ url: i.url, name: r.name ?? i.url, version: r.version ?? '', trust: i.trust })
  }
  attempt('imports', () => stores.imports.set(imports))

  const kinds = ((await value(host, from, 'application', Ops.key(P.kinds))) ?? []) as { kind: string; component: string; modes?: string[] }[]
  const kindBy = new Map(kinds.map(k => [k.kind, k]))
  const codeOps = (kind: string | undefined) => (kind !== undefined && Object.hasOwn(deps.catalog, kind) ? deps.catalog[kind]!.code : undefined)
  const kindOfComponent = new Map(kinds.map(k => [k.component, k.kind]))
  // the systems there are, fetched once and kept current
  const existing = new Set((((await value(host, from, 'application', Ops.key(P.systems))) ?? []) as { id: string }[]).map(s => s.id))

  const configuring: Promise<void>[] = []   // started together: a frame that never answers costs one wait, not one each
  const ok = new Set<string>()   // systems that exist
  const needs: { system: string; id: string; needs: NonNullable<NanoApp['systems'][number]['instances'][number]['needs']> }[] = []   // of the instances made, resolved once everything is
  for (const sys of app.systems) {
    if (!existing.has(sys.id)) {
      const r = await call('application', P.createSystem, sys.id)
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
      const made = await call('application', P.createComponent, { kind: i.kind, name: i.id, system: sys.id, ...(mode && { mode }), ...(i.allow && { allow: i.allow }), ...(i.deny && { deny: i.deny }) })
      if ('error' in made) { fail(what, made); continue }
      needs.push({ system: sys.id, id: i.id, needs: i.needs ?? {} })
      if (i.config === undefined) continue
      if (codeOps(i.kind) && !consent(sys.id, i.id)) { notes.push(`${what}: its ${i.kind} code was not applied (not agreed to)`); continue }
      configuring.push(within(rt.call(from, i.id, `${k.component}/configure`, i.config), deps.waits?.configure ?? 5000, 'configure').catch((e: unknown) => ({ error: msg(e) }))
        .then(c => { if ('error' in c) fail(`${what} configure`, c) }))
    }
  }
  await Promise.all(configuring)

  for (const sys of app.systems) {
    const rt = ok.has(sys.id) ? (sys.id === host.registry.id ? host : runtimeOf(host.registry, sys.id)) : undefined
    if (!rt) { if (sys.subscriptions.length) notes.push(`system ${sys.id}: its subscriptions were skipped`); continue }
    for (const s of sys.subscriptions) {
      const what = `${sys.id}: ${s.source} ${s.op} -> ${s.listener} ${s.target}`
      // the platform's and registry's ops create and wire things, the gateway's and controls' drive the host's UI: a document never drives them
      if (HOST_DRIVEN(s.listener)) { notes.push(`${what}: ${s.listener} is reserved by the host, skipped`); continue }
      const missing = [s.source === '*' ? undefined : s.source, s.listener].find(x => x !== undefined && !rt.registry.get(x))
      if (missing) { notes.push(`${what}: ${missing} is not there, skipped`); continue }
      // a subscription into a code-taking op (setCode, configure) would feed the document's data to code: needs the same consent
      const lc = rt.registry.snapshot().instances.find(x => x.id === s.listener)?.component
      const feedsCode = codeTarget(deps.catalog, lc === undefined ? undefined : kindOfComponent.get(lc), s.target)
      // the host's own code (ex-map's setCode) is never the document's to change; wires into a built-in's other ops are kept
      if (feedsCode && RESERVED(s.listener)) { notes.push(`${what}: ${s.listener}'s code is reserved by the host, skipped`); continue }
      if (feedsCode && !consent(sys.id, s.listener)) { notes.push(`${what}: it feeds code and was not applied (not agreed to)`); continue }
      if (rt.registry.snapshot().subscriptions.some(x => x.source === s.source && x.op === s.op && x.listener === s.listener && x.target === s.target)) { notes.push(`${what}: already wired, skipped`); continue }
      // the platform's connect needs a named source; a '*' one goes straight to the registry
      try {
        const r = s.source === '*' ? rt.registry.subscribe(s) : await call('application', P.connect, { system: sys.id, ...s })
        if ('error' in r) fail(what, r)
      } catch (e) { notes.push(`${what}: ${msg(e)}`) }
    }
  }

  // workspaces are the application's screens: 'replace' takes out the others first (Main stays, its layout is replaced below)
  const screens = ((await value(host, from, 'application', Ops.key(P.screens))) ?? []) as Screen[]
  if (replace) for (const s of screens) if (s.id !== MAIN) { const r = await call('application', P.removeScreen, s.id); if ('error' in r) fail(`workspace ${s.id}`, r) }
  const taken = new Set(replace ? [] : screens.map(s => s.id))
  for (const w of app.workspaces) {
    if (w.id === MAIN && !replace) continue   // Main is always there: Import leaves it as it is
    if (taken.has(w.id)) { notes.push(`workspace ${w.id} already exists, skipped`); continue }
    // Main's dock always runs on the host, whatever the document says
    const system = w.id === MAIN ? host.registry.id : w.system
    // a screen needs its system: one the document doesn't define is made empty (as a page start-up would)
    if (!existing.has(system)) {
      const r = await call('application', P.createSystem, system)
      if ('error' in r) { fail(`workspace ${w.id}: system ${system}`, r); continue }
      existing.add(system)
    }
    const r = await call('application', P.setScreen, { id: w.id, title: w.title, icon: w.icon && deps.known.icon(w.icon) ? w.icon : 'folder', system, layout: w.layout ?? null })
    if ('error' in r) fail(`workspace ${w.id}`, r); else taken.add(w.id)
  }

  // tags last: what they name now exists. A malformed or missing ref is a note.
  for (const [r, ts] of Object.entries(app.tags ?? {})) {
    if (!parseRef(r)) { notes.push(`tags of ${JSON.stringify(r)}: not a ref, dropped`); continue }
    for (const tag of ts) { const t = await call('application', P.tag, { ref: r, tag }); if ('error' in t) { fail(`tags of ${r}`, t); break } }
  }

  // needs last: every instance a pin may name now exists, with its tags. A pin that resolves overrides auto-bind; loading never makes one.
  for (const n of needs) for (const [need, selector] of Object.entries(n.needs)) {
    const what = `${n.system}/${n.id} needs ${need}`, r = await call('application', P.setSelector, { ref: `instance:${n.system}/${n.id}`, need, selector })
    if ('error' in r) { fail(what, r); continue }
    const v = r.value as Resolution
    if ('bound' in v) continue
    notes.push(`${what}: ${'make' in v ? 'nothing matches' : v.reason}`)
    await call('application', P.unbindNeed, { ref: `instance:${n.system}/${n.id}`, need })   // auto-bind may have bound it meanwhile: a pin that fails leaves it disabled (none: nothing to undo)
  }
  // then the needs the document leaves out: auto-bind ran when each instance came, maybe before its provider did
  for (const n of needs) {
    const ref = `instance:${n.system}/${n.id}`
    const declared = ((await value(host, from, 'application', Ops.key(P.needsOf), ref)) ?? []) as { need: string; selector: Selector; binding?: string }[]
    for (const d of declared) {
      if (d.binding || d.need in n.needs) continue
      const r = await call('application', P.setSelector, { ref, need: d.need, selector: d.selector })
      if ('error' in r) { fail(`${n.system}/${n.id} needs ${d.need}`, r); continue }
      const v = r.value as Resolution
      if (!('bound' in v)) notes.push(`${n.system}/${n.id} needs ${d.need}: ${'make' in v ? 'nothing matches' : v.reason}`)
    }
  }
}
