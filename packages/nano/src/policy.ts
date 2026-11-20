/**
 * Policy: the yes/no check a runtime makes before it delivers a message or adds a subscription.
 *
 *   const p = Policies.allowAll()
 *   p.isAllowed(ask)   // { approved: true }
 *   PolicyRules([{ allow: 'call', outside: true, to: 'acme.Kv' }, { deny: '*' }]).isAllowed(ask)   // first match wins
 */
import { Type, type Static } from 'typebox'
export type Verdict = { approved: true } | { approved: false; reason: string }
/** What a policy is asked: a message's envelope. `outside` is true when `from` is not placed in `runtime` (the host, or another runtime's pod). */
export type Ask = { runtime: string; kind: 'call' | 'pipe' | 'on' | 'subscribe' | 'unsubscribe' | 'lifecycle' | 'start'; from: string; to: string; port?: string; outside: boolean; data?: unknown }
export type Policy = { isAllowed(ask: Ask): Verdict }

const ALLOW_ALL: Policy = Object.freeze({ isAllowed: () => ({ approved: true as const }) })

/** `allowAll()` is one shared policy, so saving can tell it apart from a custom one. */
export const Policies = {
  allowAll: (): Policy => ALLOW_ALL,
}

const Kind = Type.Union([Type.Literal('call'), Type.Literal('pipe'), Type.Literal('on'), Type.Literal('subscribe'), Type.Literal('unsubscribe'), Type.Literal('lifecycle'), Type.Literal('start'), Type.Literal('*')])
const Kinds = Type.Union([Kind, Type.Array(Kind)])
const Match = { from: Type.Optional(Type.String()), toPod: Type.Optional(Type.String()), toInterface: Type.Optional(Type.String()),
  toPort: Type.Optional(Type.String()), outside: Type.Optional(Type.Boolean()) }
/**
 * A rule: `allow` or `deny` these kinds of message, from a pod or 'host' (`from`), to a target named by its resource
 * type: `toPod` (a pod name), `toInterface` (an interface coordinate: any of its ops), `toPort` (a port coordinate,
 * `iface/op`: that op only). Each field absent or '*' matches anything; all given fields must match.
 */
export const Rule = Type.Union([
  Type.Object({ allow: Kinds, ...Match }, { additionalProperties: false }),
  Type.Object({ deny: Kinds, ...Match }, { additionalProperties: false }),
])
export type Rule = Static<typeof Rule>

/** A field matches when absent, `*`, or equal. */
const any = (v: string | undefined, x: string | undefined) => v === undefined || v === '*' || v === x
type Compiled = { i: number; allow: boolean; kinds: ReadonlySet<string>; r: Rule }
const fits = (c: Compiled, a: Ask, iface: string | undefined) =>
  (c.kinds.has('*') || c.kinds.has(a.kind)) && any(c.r.toPod, a.to) && any(c.r.toInterface, iface) && any(c.r.toPort, a.port)
  && (c.r.outside === undefined || c.r.outside === a.outside)

/**
 * The first rule matching the ask decides; none denies (`no rule allows it`); a deny's reason is `rules[i]`.
 * Compiled once: rules are indexed by `from` (a named caller's rules, and those for any caller), so an ask looks only
 * at rules that could match its caller, still in their order.
 */
export function PolicyRules(rules: Rule[]): Policy {
  const byFrom = new Map<string, Compiled[]>(), anyFrom: Compiled[] = []
  rules.forEach((r, i) => {
    const c = { i, allow: 'allow' in r, kinds: new Set([('allow' in r ? r.allow : r.deny)].flat()), r }
    if (r.from === undefined || r.from === '*') anyFrom.push(c)
    else { const l = byFrom.get(r.from); if (l) l.push(c); else byFrom.set(r.from, [c]) }
  })
  return { isAllowed: ask => {
    const iface = ask.port?.slice(0, ask.port.lastIndexOf('/'))
    const named = byFrom.get(ask.from) ?? []
    let a = 0, b = 0, hit: Compiled | undefined
    while (!hit && (a < named.length || b < anyFrom.length)) {   // both lists in rule order: merge them
      const c = b >= anyFrom.length || (a < named.length && named[a]!.i < anyFrom[b]!.i) ? named[a++]! : anyFrom[b++]!
      if (fits(c, ask, iface)) hit = c
    }
    if (!hit) return { approved: false, reason: 'no rule allows it' }
    return hit.allow ? { approved: true } : { approved: false, reason: `rules[${hit.i}]` }
  } }
}
