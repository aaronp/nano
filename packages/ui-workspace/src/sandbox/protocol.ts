// The sandbox port protocol: what the host's stand-in and the iframe's serve say to each other over a MessagePort.
// Everything received is untrusted data: check it before use.
import type { Op } from '@pritzlaff/nano-core'
import type { CatalogEntry } from '@pritzlaff/nano-elements'

/** A catalog entry as data (its component left behind): ops with their TypeBox schemas, which are JSON. */
export type SerialEntry = { id: { ns: string; name: string }; title: string; tag?: string; description?: string; ops: Op[] }

export type Msg =
  | { type: 'call'; id: number; op: string; arg: unknown }
  | { type: 'result'; id: number; result: unknown }
  | { type: 'publish'; op: string; data: unknown }
  | { type: 'outcall'; id: number; target: string; op: string; arg: unknown }
  | { type: 'outresult'; id: number; result: unknown }
  | { type: 'ready' }
  | { type: 'failed'; error: string }
  | { type: 'catalog'; entries: Record<string, SerialEntry> }

/** A catalog entry as data. */
export const serialEntry = (e: CatalogEntry): SerialEntry => ({
  id: { ...e.component.id }, title: e.title, ...(e.tag !== undefined && { tag: e.tag }),
  ...(e.component.description !== undefined && { description: e.component.description }),
  ops: [...e.component.actions.values()].map(a => JSON.parse(JSON.stringify(a.op)) as Op),
})

const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const optStr = (v: unknown) => v === undefined || typeof v === 'string'

/** Whether a schema (any depth) has a regex-running keyword: the iframe controls schema and data, so a backtracking pattern would freeze the host. */
// TypeBox's own Record key patterns (string, number, integer keys): linear, so safe to run on any key
const RECORD_KEYS = new Set(['^.*$', '^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$', '^-?(?:0|[1-9][0-9]*)$'])
const safeKeys = (v: unknown) => !!v && typeof v === 'object' && Object.keys(v).every(k => RECORD_KEYS.has(k))
const hasRegex = (x: unknown): boolean => !!x && typeof x === 'object' && Object.entries(x).some(([k, v]) =>
  k === 'pattern' || k === 'format' || (k === 'patternProperties' && !safeKeys(v)) || hasRegex(v))

/** The entry if `x` is one, else why not. */
export function checkEntry(x: unknown): SerialEntry | string {
  if (!obj(x)) return 'entry is not an object'
  const id = x.id
  if (!obj(id) || typeof id.ns !== 'string' || typeof id.name !== 'string') return 'entry id needs ns and name'
  if (typeof x.title !== 'string') return 'entry title is not a string'
  if (!optStr(x.tag) || !optStr(x.description)) return 'entry tag or description is not a string'
  if (!Array.isArray(x.ops)) return 'entry ops is not an array'
  const seen = new Set<string>()
  for (const op of x.ops) {
    if (!obj(op) || typeof op.ns !== 'string' || typeof op.name !== 'string') return 'an op needs ns and name'
    if (!op.name || op.name.includes('/')) return `op name ${op.name} must be non-empty and have no /`
    if (seen.has(`${op.ns}/${op.name}`)) return `duplicate op ${op.ns}/${op.name}`
    seen.add(`${op.ns}/${op.name}`)
    if (!optStr(op.description)) return `op ${op.ns}/${op.name} description is not a string`
    for (const k of ['input', 'output']) if (op[k] !== undefined && !obj(op[k])) return `op ${op.ns}/${op.name} ${k} is not a schema object`
    for (const k of ['input', 'output']) if (hasRegex(op[k])) return `op ${op.ns}/${op.name} ${k} uses pattern or format`
  }
  return {
    id: { ns: id.ns, name: id.name }, title: x.title,
    ...(x.tag !== undefined && { tag: x.tag }), ...(x.description !== undefined && { description: x.description }),
    ops: (x.ops as Record<string, unknown>[]).map(o => ({ ns: o.ns, name: o.name, ...(o.input !== undefined && { input: o.input }), ...(o.output !== undefined && { output: o.output }), ...(o.description !== undefined && { description: o.description }) }) as Op),
  }
}

/** A result off the wire, if it is one. */
export const asResult = (r: unknown): { value: unknown } | { error: string } | undefined =>
  obj(r) && 'value' in r ? { value: r.value } : obj(r) && typeof r.error === 'string' ? { error: r.error } : undefined
