/**
 * Policy: the yes/no check a runtime makes before it delivers a message or adds a subscription.
 *
 *   const p = Policies.allowAll()
 *   p.isAllowed(ask)   // { approved: true }
 */
export type Verdict = { approved: true } | { approved: false; reason: string }
/** What a policy is asked: a message's envelope. `outside` is true when `from` is not placed in `runtime` (the host, or another runtime's pod). */
export type Ask = { runtime: string; kind: 'call' | 'pipe' | 'on' | 'subscribe' | 'unsubscribe' | 'lifecycle'; from: string; to: string; port?: string; outside: boolean; data?: unknown }
export type Policy = { isAllowed(ask: Ask): Verdict }

const ALLOW_ALL: Policy = Object.freeze({ isAllowed: () => ({ approved: true as const }) })

/** `allowAll()` is one shared policy, so saving can tell it apart from a custom one. */
export const Policies = {
  allowAll: (): Policy => ALLOW_ALL,
}
