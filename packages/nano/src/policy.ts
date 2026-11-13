/**
 * Policy: the yes/no check a runtime makes before it connects or delivers between two members.
 *
 *   const p = Policies.allowAll()
 *   p.isAllowed('a#1', 'b#1', data)   // { approved: true }
 */
export type Verdict = { approved: true } | { approved: false; reason: string }
export type Policy = { isAllowed(src: string, dest: string, data: unknown): Verdict }

export const Policies = {
  allowAll: (): Policy => ({ isAllowed: () => ({ approved: true }) }),
}
