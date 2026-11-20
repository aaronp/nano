/**
 * The Outline: a tree of pages (`roots`, each page's `children`, ids that never change), each page a set of slots over
 * the Application plus the client's opaque `layout` and `meta`. Written out (JSON), coordinates and selectors are their
 * strings; `parse` reads them back, refusing a malformed document whole (a broken tree too: see tree.ts).
 *
 *   const doc: Outline = { roots: ['home'], pages: { home: { slots: { a: { kind: 'pod', pod: Coord.pod(impl, Coord.runtime('r'), 'a') } } } } }
 *   parse(JSON.parse(JSON.stringify(doc)))           // success(doc), coordinates again
 *   parse({ pages: { a, b } })                        // flat (the Platform's shape): every page a root, in document order
 *   readSelector({ implements: 'acme.Counter' })      // { implements: InterfaceCoord }
 */
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'
import { Coord, failure, success, type NanoResult, type PodCoord, type SelectorData } from '@pritzlaff/nano-core'
import { fault } from './tree.ts'

export type Slot = { kind: 'pod'; pod: PodCoord } | { kind: 'select'; select: SelectorData } | { kind: 'view'; view: string }
/** `children` are the page's place in the tree; `layout` and `meta` are the client's: the Outline keeps them and reads neither. */
export type Page = { title?: string; children?: string[]; slots: Record<string, Slot>; layout?: unknown; meta?: unknown }
export type Outline = { roots: string[]; pages: Record<string, Page> }

const strict = { additionalProperties: false } as const
const coord = Type.String({ minLength: 1 })
const WrittenSelector = Type.Object({
  implements: Type.Optional(coord), tags: Type.Optional(Type.Array(Type.String())), implementation: Type.Optional(coord),
  provider: Type.Optional(coord), runtime: Type.Optional(coord),
}, strict)
const WrittenSlot = Type.Union([
  Type.Object({ kind: Type.Literal('pod'), pod: coord }, strict),
  Type.Object({ kind: Type.Literal('select'), select: WrittenSelector }, strict),
  Type.Object({ kind: Type.Literal('view'), view: Type.String({ minLength: 1 }) }, strict),
])
const ids = Type.Array(Type.String())
const WrittenPage = Type.Object({ children: Type.Optional(ids), slots: Type.Record(Type.String(), WrittenSlot), title: Type.Optional(Type.String()), layout: Type.Optional(Type.Unknown()), meta: Type.Optional(Type.Unknown()) }, strict)
/** An Outline written out: its coordinates as strings; without `roots`, every page is a root. */
export const Written = Type.Object({ roots: Type.Optional(ids), pages: Type.Record(Type.String(), WrittenPage) }, strict)

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const string = (v: unknown, kind: string) => { if (typeof v !== 'string') throw new Error(`bad ${kind} coordinate ${JSON.stringify(v)}`); return v }

/** Only the selector fields of `written`, each read back to its coordinate (a bad one throws). */
export function readSelector({ implements: i, tags, implementation: m, provider: p, runtime: r }: Record<string, unknown>): SelectorData {
  return { ...(i !== undefined && { implements: Coord.parse('interface', string(i, 'interface')) }), ...(tags !== undefined && { tags: tags as string[] }),
    ...(m !== undefined && { implementation: Coord.parse('implementation', string(m, 'implementation')) }),
    ...(p !== undefined && { provider: Coord.parse('namespace', string(p, 'namespace')) }),
    ...(r !== undefined && { runtime: Coord.parse('runtime', string(r, 'runtime')) }) }
}

const slot = (s: Static<typeof WrittenSlot>): Slot =>
  s.kind === 'pod' ? { kind: 'pod', pod: Coord.parse('pod', s.pod) } : s.kind === 'select' ? { kind: 'select', select: readSelector(s.select) } : { kind: 'view', view: s.view }

/** `/pages/<page>/slots/<slot>/…` as "page p, slot s". */
const where = (path: string) => { const [, , p, , s] = path.split('/'); return [p && `page ${p}`, s && `slot ${s}`].filter(Boolean).join(', ') || 'the document' }

/** A written Outline read back, its ids (the id rule, as a `RuntimeCoord`'s), coordinates and tree checked; all of it or a failure naming the page (and slot). Never throws. */
export function parse(json: unknown): NanoResult<Outline> {
  const e = Value.Errors(Written, json)[0]
  if (e) return failure('invalid-input', `${where(e.instancePath)}: ${e.message}`)
  const read = <T>(at: string, f: () => T): NanoResult<T> => { try { return success(f()) } catch (x) { return failure('invalid-input', `${at}: ${message(x)}`) } }
  const pages: [string, Page][] = []
  const written = structuredClone(json as Static<typeof Written>)
  for (const [id, page] of Object.entries(written.pages)) {
    const named = read(`page ${id}`, () => Coord.runtime(id))
    if (!named.ok) return named
    const slots: [string, Slot][] = []
    for (const [sid, s] of Object.entries(page.slots)) {
      const r = read(`page ${id}, slot ${sid}`, () => (Coord.runtime(sid), slot(s)))
      if (!r.ok) return r
      slots.push([sid, r.value])
    }
    pages.push([id, { ...page, slots: Object.fromEntries(slots) }])
  }
  const doc: Outline = { roots: written.roots ?? pages.map(([id]) => id), pages: Object.fromEntries(pages) }
  const why = fault(doc)
  return why ? failure('invalid-input', why) : success(doc)
}
