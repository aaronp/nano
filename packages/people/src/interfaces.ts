// What each layer offers the one above: storage (Db), shared validation, the api and the bff.
import { Type, type Static, type TSchema } from 'typebox'
import { iface } from '@pritzlaff/nano-core'

export const Outcome = <T extends TSchema>(value: T) => Type.Union([
  Type.Object({ ok: Type.Literal(true), value }),
  Type.Object({ ok: Type.Literal(false), reason: Type.String() }),
])
export type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string }
export const ok = <T>(value: T): Outcome<T> => ({ ok: true, value }), no = (reason: string) => ({ ok: false as const, reason })

export const Person = Type.Object({ name: Type.String(), email: Type.String(), postcode: Type.String() })
export const Stored = Type.Object({ id: Type.String(), person: Person })
export type Person = Static<typeof Person>
export type Stored = Static<typeof Stored>

// ── storage ───────────────────────────────────────────────────────────────
export const Db = iface('example/db', {
  save: { in: Type.Object({ key: Type.String(), value: Type.Unknown() }), out: Outcome(Type.String()) },
  load: { in: Type.String(), out: Type.Unknown() },
  keys: { in: Type.Null(), out: Type.Array(Type.String()) },
})

// ── validation, shared by app and api ─────────────────────────────────────
export const Validation = iface('example/person-validation', { check: { in: Type.Unknown(), out: Outcome(Person) } })

// ── api ───────────────────────────────────────────────────────────────────
export const PersonApi = iface('example/person-api', {
  create: { in: Person, out: Outcome(Type.String()) },
  get: { in: Type.String(), out: Type.Union([Stored, Type.Null()]) },
  list: { in: Type.Null(), out: Type.Array(Stored) },
})

// ── bff: what the form needs, and nothing else ────────────────────────────
export const Bff = iface('example/bff', {
  save: { in: Person, out: Outcome(Type.String()) },
  listPersons: { in: Type.Null(), out: Type.Array(Stored) },
  getPerson: { in: Type.String(), out: Type.Union([Stored, Type.Null()]) },
  lookup: { in: Type.String({ description: 'A name' }), out: Outcome(Type.String()) },
})
