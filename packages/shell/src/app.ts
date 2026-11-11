// The nano.json document: a whole app (title, theme, profile, imports, systems, workspaces) as data any host can read and write.
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'
import { safeAvatar, safeHref } from './profile'

// ids are free text from the platform: non-empty, no '/', whitespace or control characters
const ID = '^[^/\\s\\x00-\\x1f\\x7f]+$', KIND = '^[a-z][a-z0-9]*(-[a-z0-9]+)*$', PATH = '^/[a-z0-9][a-z0-9-]*(/[a-z0-9][a-z0-9-]*)*$'
const s = (max: number, description: string, extra: object = {}) => Type.String({ maxLength: max, description, ...extra })
const list = <T extends import('typebox').TSchema>(t: T, maxItems: number, description: string) => Type.Array(t, { maxItems, description })

export const MAX_BYTES = 1_000_000, MAX_DEPTH = 32

export const NanoAppSchema = Type.Object({
  nano: Type.Literal(1, { description: 'The document version' }),
  title: s(120, 'The app title'),
  theme: Type.Optional(Type.Object({
    id: s(64, 'A theme id the host knows; unknown means the host default'),
    mode: Type.Optional(Type.Union([Type.Literal('system'), Type.Literal('light'), Type.Literal('dark')], { description: 'Colour mode' })),
  }, { description: 'The chosen theme' })),
  profile: Type.Optional(Type.Object({
    user: Type.Object({ name: s(80, 'The name shown'), avatar: Type.Optional(s(100_000, 'An https: or data:image/ URL')) }),
    entries: list(Type.Object({ label: s(40, 'Link text'), href: s(400, 'Link target: #, /, http(s): or mailto:') }), 20, 'Menu links'),
  }, { description: 'Who the user is and their menu' })),
  imports: list(Type.Object({ url: s(2000, 'Where the package is'), trust: Type.Union([Type.Literal('trusted'), Type.Literal('sandboxed')], { description: 'How it is loaded' }) }), 50, 'Packages to import'),
  systems: list(Type.Object({
    id: s(64, 'The system id', { pattern: ID }),
    instances: list(Type.Object({
      id: s(64, 'The instance id', { pattern: ID }), kind: s(64, 'The component kind', { pattern: KIND }),
      mode: Type.Optional(Type.Union([Type.Literal('host'), Type.Literal('sandbox'), Type.Literal('isolated-sandbox')], { description: 'Where it runs' })),
      allow: Type.Optional(list(s(200, 'A guard selector'), 50, 'Allowed ops')), deny: Type.Optional(list(s(200, 'A guard selector'), 50, 'Denied ops')),
      config: Type.Optional(Type.Unknown({ description: 'What the component needs to be recreated' })),
    }), 200, 'The system\'s instances'),
    subscriptions: list(Type.Object({ source: s(64, 'Publisher, or *', { pattern: ID }), op: s(200, 'Published op key'), listener: s(64, 'Listener instance', { pattern: ID }), target: s(200, 'Listener action key') }), 500, 'Connections'),
  }), 50, 'The systems'),
  workspaces: list(Type.Object({
    id: s(120, 'The workspace path', { pattern: PATH }), title: s(120, 'The workspace title'), system: s(64, 'Its system', { pattern: ID }),
    icon: Type.Optional(s(64, 'Its icon')), layout: Type.Unknown({ description: "The dock's saved layout JSON" }),
  }), 50, 'Workspaces, in nav order'),
}, { description: 'A nano.json document, version 1' })
export type NanoApp = Static<typeof NanoAppSchema>

/** Ids the host owns: never written, skipped on load. */
export const RESERVED = (id: string): boolean => id === 'platform' || id === 'registry' || id === 'profile' || id.startsWith('ex-')

const depth = (v: unknown, n = 0): number => {
  if (n > MAX_DEPTH || !v || typeof v !== 'object') return n
  let m = n
  for (const x of Object.values(v)) m = Math.max(m, depth(x, n + 1))
  return m
}
const pick = <T extends object>(o: T, keys: (keyof T)[]) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]])) as T

/** A document from untrusted data, or a short reason it was refused. Never throws. */
export function checkApp(x: unknown): NanoApp | string {
  try {
    let text: string | undefined
    try { text = JSON.stringify(x) } catch { return 'not JSON (cyclic or unserialisable)' }
    if (text === undefined) return 'not JSON'
    if (new TextEncoder().encode(text).length > MAX_BYTES) return 'larger than 1 MB'
    const a = JSON.parse(text) as NanoApp   // one plain copy: everything below validates and rebuilds from it
    if (!Value.Check(NanoAppSchema, a)) {
      const e = Value.Errors(NanoAppSchema, a)[0]
      return `not a nano.json version 1 document${e ? `: ${e.instancePath || '/'} ${e.message}` : ''}`
    }
    for (const e of a.profile?.entries ?? []) if (!safeHref(e.href)) return `profile href ${JSON.stringify(e.href)} must start with #, /, http:, https: or mailto:`
    const av = a.profile?.user.avatar
    if (av !== undefined && !safeAvatar(av)) return 'profile avatar must be an http(s): or data:image/ URL'
    for (const sys of a.systems) for (const i of sys.instances) if (depth(i.config) > MAX_DEPTH) return `config of ${i.id} nests deeper than ${MAX_DEPTH}`
    for (const w of a.workspaces) if (depth(w.layout) > MAX_DEPTH) return `layout of ${w.id} nests deeper than ${MAX_DEPTH}`
    const out: NanoApp = {
      nano: 1, title: a.title,
      ...(a.theme && { theme: pick(a.theme, ['id', 'mode']) }),
      ...(a.profile && { profile: { user: pick(a.profile.user, ['name', 'avatar']), entries: a.profile.entries.map(e => ({ label: e.label, href: e.href })) } }),
      imports: a.imports.map(i => ({ url: i.url, trust: i.trust })),
      systems: a.systems.map(sys => ({
        id: sys.id,
        instances: sys.instances.map(i => { const o = pick(i, ['id', 'kind', 'mode', 'allow', 'deny']); if (i.config !== undefined) o.config = i.config; return o }),
        subscriptions: sys.subscriptions.map(u => ({ source: u.source, op: u.op, listener: u.listener, target: u.target })),
      })),
      workspaces: a.workspaces.map(w => ({ ...pick(w, ['id', 'title', 'system', 'icon']), layout: w.layout })),
    }
    return out
  } catch (e) { return `could not be read: ${e instanceof Error ? e.message : 'unknown error'}` }
}

const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as Record<string, unknown>)[k])])) : v
/** The document as JSON with keys sorted, so equal documents give equal strings. */
export const canonicalApp = (a: NanoApp): string => JSON.stringify(sorted(a))
