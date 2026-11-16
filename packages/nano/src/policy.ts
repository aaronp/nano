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
export type Ask = { runtime: string; kind: 'call' | 'pipe' | 'on' | 'subscribe' | 'unsubscribe' | 'lifecycle'; from: string; to: string; port?: string; outside: boolean; data?: unknown }
export type Policy = { isAllowed(ask: Ask): Verdict }

const ALLOW_ALL: Policy = Object.freeze({ isAllowed: () => ({ approved: true as const }) })

/** `allowAll()` is one shared policy, so saving can tell it apart from a custom one. */
export const Policies = {
  allowAll: (): Policy => ALLOW_ALL,
}

const Kind = Type.Union([Type.Literal('call'), Type.Literal('pipe'), Type.Literal('on'), Type.Literal('subscribe'), Type.Literal('unsubscribe'), Type.Literal('lifecycle'), Type.Literal('*')])
const Kinds = Type.Union([Kind, Type.Array(Kind)])
const Match = { from: Type.Optional(Type.String()), to: Type.Optional(Type.String()), outside: Type.Optional(Type.Boolean()) }
/** A rule: `allow` or `deny` these kinds; `from` a pod or 'host', `to` a pod, interface or port coordinate; absent or '*' matches anything. */
export const Rule = Type.Union([
  Type.Object({ allow: Kinds, ...Match }, { additionalProperties: false }),
  Type.Object({ deny: Kinds, ...Match }, { additionalProperties: false }),
])
export type Rule = Static<typeof Rule>

const any = (v: string | undefined, ...xs: (string | undefined)[]) => v === undefined || v === '*' || xs.includes(v)
const matches = (r: Rule, a: Ask) => {
  const kinds = [('allow' in r ? r.allow : r.deny)].flat()
  const iface = a.port?.slice(0, a.port.lastIndexOf('/'))
  return (kinds.includes('*') || kinds.includes(a.kind)) && any(r.from, a.from) && any(r.to, a.to, a.port, iface)
    && (r.outside === undefined || r.outside === a.outside)
}

/** The first rule matching the ask decides; none denies (`no rule allows it`); a deny's reason is `rules[i]`. */
export function PolicyRules(rules: Rule[]): Policy {
  return { isAllowed: ask => {
    const i = rules.findIndex(r => matches(r, ask))
    if (i < 0) return { approved: false, reason: 'no rule allows it' }
    return 'allow' in rules[i]! ? { approved: true } : { approved: false, reason: `rules[${i}]` }
  } }
}
