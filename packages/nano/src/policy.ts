/**
 * Policy: the yes/no check a runtime makes before it delivers a message or adds a subscription between two pods.
 *
 *   const p = Policies.allowAll()
 *   p.isAllowed('a', 'b', data)   // { approved: true }
 */
export type Verdict = { approved: true } | { approved: false; reason: string }
export type Policy = { isAllowed(src: string, dest: string, data: unknown): Verdict }

const ALLOW_ALL: Policy = Object.freeze({ isAllowed: () => ({ approved: true as const }) })

/** `allowAll()` is one shared policy, so saving can tell it apart from a custom one. */
export const Policies = {
  allowAll: (): Policy => ALLOW_ALL,
}
