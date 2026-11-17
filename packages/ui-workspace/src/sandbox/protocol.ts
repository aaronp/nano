/**
 * The sandbox protocol: what the host's stand-in and the frame's `serve` say to each other over a MessagePort.
 * Everything received is untrusted data: `checkMsg` it before use. A provider loaded only in frames is described as data.
 *
 *   const m = checkMsg(e.data)                  // a Msg, or why not (over 1 MiB, a bad shape, a regex in a schema)
 *   describeProvider(acme, { 'acme/s': 'x-s' }) // coords, interfaces with ops and schemas, dependencies, config, views
 */
import { isNanoResult, type NanoResult, type Provider, type SchemaDef, type SelectorData } from '@pritzlaff/nano-core'
import type { Edge } from './edges.ts'
import { isMode, isThemeId, type Mode, type ThemeId } from '../lib/themes.ts'

type Reason = 'restarted' | 'removed' | 'changed' | 'closed'
type R = NanoResult<unknown>

export type Msg =
  // host → frame
  | { type: 'build'; pod: string; runtimes: string[]; coord: string; url: string; config: unknown; edges: Edge[] }
  | { type: 'call'; id: number; port: string; input: unknown }
  | { type: 'outresult'; id: number; result: R }
  | { type: 'edges'; edges: Edge[] }
  | { type: 'close'; reason: Reason }
  | { type: 'view-result'; id: number; result: R }
  | { type: 'stream'; event: Record<string, unknown> }
  | { type: 'probe'; url: string }
  | { type: 'theme'; theme: ThemeId; mode: Mode }   // the host's theme choice: an id, never CSS
  | { type: 'emission'; id: number; event: unknown }   // one emission heard for the frame's `on`/`view-on` id
  | { type: 'ended'; id: number; result: R }           // that subscription ended: success, or the Fail (denied, not-found, …)
  // frame → host
  | { type: 'ready' } | { type: 'closed' }
  | { type: 'failed'; error: string }
  | { type: 'result'; id: number; result: R }
  | { type: 'publish'; op: string; data: unknown }
  | { type: 'outcall'; id: number; pod: string; runtime: string; op: string; input: unknown }
  | { type: 'view-call'; id: number; op: string; input: unknown }
  | { type: 'on'; id: number; pod: string; runtime: string; op: string }   // the pod's `on` through its edge: subscribed as the pod
  | { type: 'view-on'; id: number; op: string }                            // the view's own pod's event: subscribed as the page's view is
  | { type: 'off'; id: number }
  | { type: 'described'; providers: Described[] }
  | { type: 'warn'; reason: string }

/** A schema as data: its type name and its JSON schema. */
export type SchemaJson = { type: string; schema: Record<string, unknown> }
type DescribedOp = { name: string; kind: 'action' | 'event'; input?: SchemaJson; output?: SchemaJson; description?: string }
type DescribedImpl = {
  coord: string; description?: string; provides: { coord: string; ops: DescribedOp[] }[]
  dependencies: Record<string, SelectorData>; config?: SchemaJson
}
/** A provider as data, with the view tag of each implementation that has one. */
/** `built`: the module's stamp (the nano-core it was built with), when it has one. */
export type Described = { coord: string; meta: Record<string, string>; implementations: DescribedImpl[]; views: Record<string, string>; built?: Record<string, string> }

const json = (s: SchemaDef): SchemaJson => ({ type: s.label ?? '', schema: JSON.parse(JSON.stringify(s.schema)) })

export const describeProvider = (p: Provider, views: Record<string, string>): Described => ({
  coord: p.coord, meta: { ...p.meta }, views: { ...views },
  implementations: [...p.implementations.values()].map(i => ({
    coord: i.coord, ...(i.description !== undefined && { description: i.description }),
    provides: i.provides.map(f => ({ coord: f.coord, ops: Object.values(f.ops).map(o => ({
      name: o.name, kind: o.kind, ...(o.input && { input: json(o.input) }), ...(o.output && { output: json(o.output) }),
      ...(o.description !== undefined && { description: o.description }),
    })) })),
    dependencies: structuredClone(i.dependencies) as Record<string, SelectorData>, ...(i.config && { config: json(i.config) }),
  })),
})

const MAX = 1024 * 1024
type Check = (v: unknown) => boolean
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const str: Check = v => typeof v === 'string', num: Check = v => typeof v === 'number', any: Check = () => true
const optStr: Check = v => v === undefined || str(v)
const strs: Check = v => Array.isArray(v) && v.every(str)
const arrOf = (c: (v: unknown) => string | undefined) => (v: unknown) => Array.isArray(v) && v.every(x => c(x) === undefined)
const edge = (v: unknown) => obj(v) && ['pod', 'runtime', 'implementation', 'provider'].every(k => str(v[k])) && strs(v.provides) && strs(v.tags)
  ? undefined : 'bad edge'

/** Whether a schema (any depth) has a regex-running keyword: the frame controls schema and data, so a backtracking pattern would freeze the host. */
// TypeBox's own Record key patterns (string, number, integer keys): linear, so safe to run on any key
const RECORD_KEYS = new Set(['^.*$', '^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$', '^-?(?:0|[1-9][0-9]*)$'])
const safeKeys = (v: unknown) => !!v && typeof v === 'object' && Object.keys(v).every(k => RECORD_KEYS.has(k))
const hasRegex = (x: unknown): boolean => !!x && typeof x === 'object' && Object.entries(x).some(([k, v]) =>
  k === 'pattern' || k === 'format' || (k === 'patternProperties' && !safeKeys(v)) || hasRegex(v))

const schema = (s: unknown, what: string) => s === undefined ? undefined
  : !obj(s) || !str(s.type) || !obj(s.schema) ? `${what} is not a schema` : hasRegex(s.schema) ? `${what} uses pattern or format` : undefined

const selector = (d: unknown) => obj(d) && ['implements', 'implementation', 'provider', 'runtime'].every(k => optStr(d[k]))
  && (d.tags === undefined || strs(d.tags))

function implError(i: unknown): string | undefined {
  if (!obj(i) || !str(i.coord) || !optStr(i.description)) return 'an implementation needs a coord'
  if (!Array.isArray(i.provides) || !obj(i.dependencies) || !Object.values(i.dependencies).every(selector))
    return `${i.coord}: bad provides or dependencies`
  for (const f of i.provides) {
    if (!obj(f) || !str(f.coord) || !Array.isArray(f.ops)) return `${i.coord}: an interface needs a coord and ops`
    const names = new Set<string>()
    for (const o of f.ops) {
      if (!obj(o) || !str(o.name) || !o.name || (o.name as string).includes('/') || names.has(o.name as string)) return `${f.coord}: bad or duplicate op name`
      names.add(o.name as string)
      if ((o.kind !== 'action' && o.kind !== 'event') || !optStr(o.description)) return `${f.coord}/${o.name}: bad kind or description`
      const why = schema(o.input, `${f.coord}/${o.name} input`) ?? schema(o.output, `${f.coord}/${o.name} output`)
      if (why) return why
    }
  }
  return schema(i.config, `${i.coord} config`)
}

const described = (p: unknown) => !obj(p) || !str(p.coord) || !obj(p.meta) || !Object.values(p.meta).every(str)
  || !obj(p.views) || !Object.values(p.views).every(str) || !Array.isArray(p.implementations)
  || (p.built !== undefined && (!obj(p.built) || !Object.values(p.built).every(str))) ? 'a provider needs coord, meta, views and implementations (and a built, if any, of strings)'
  : p.implementations.map(implError).find(w => w !== undefined)

const result: Check = v => isNanoResult(v)
const FIELDS: Record<Msg['type'], Record<string, Check>> = {
  build: { pod: str, runtimes: strs, coord: str, url: str, config: any, edges: arrOf(edge) },
  call: { id: num, port: str, input: any }, outresult: { id: num, result }, edges: { edges: arrOf(edge) },
  close: { reason: v => ['restarted', 'removed', 'changed', 'closed'].includes(v as string) },
  'view-result': { id: num, result }, stream: { event: obj }, probe: { url: str },
  theme: { theme: v => str(v) && isThemeId(v as string), mode: v => str(v) && isMode(v as string) },
  ready: {}, closed: {}, failed: { error: str }, result: { id: num, result }, publish: { op: str, data: any },
  outcall: { id: num, pod: str, runtime: str, op: str, input: any }, 'view-call': { id: num, op: str, input: any },
  described: { providers: Array.isArray }, warn: { reason: str },
  emission: { id: num, event: any }, ended: { id: num, result },
  on: { id: num, pod: str, runtime: str, op: str }, 'view-on': { id: num, op: str }, off: { id: num },
}

/** `x` as a message, or why it is not one: a JSON copy of it, so only JSON crosses (a Map, an ArrayBuffer or a Blob is
 * `{}`) and the size is the copy's. Never throws. */
export function checkMsg(input: unknown): Msg | string {
  let text: string | undefined
  try { text = JSON.stringify(input) } catch { return 'not JSON' }
  if (text === undefined) return 'not JSON'
  if (text.length > MAX) return `${text.length} characters of JSON is over 1 MiB`
  const x: unknown = JSON.parse(text)
  if (!obj(x) || !str(x.type) || !Object.hasOwn(FIELDS, x.type as string)) return `unknown type ${obj(x) ? String(x.type) : typeof x}`
  // JSON drops an undefined value: success(undefined) is still a result.
  if (obj(x.result) && x.result.ok === true && !('value' in x.result)) x.result.value = undefined
  const bad = Object.entries(FIELDS[x.type as Msg['type']]).find(([k, c]) => !c(x[k]))
  if (bad) return `${x.type}: bad ${bad[0]}`
  if (x.type === 'described') { const why = (x.providers as unknown[]).map(described).find(w => w !== undefined); if (why) return `described: ${why}` }
  return x as Msg
}
