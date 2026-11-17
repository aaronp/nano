/**
 * NanoResult: the value-or-Fail result every platform call returns instead of throwing.
 *
 *   const r = await client.get('k')          // NanoResult<string>
 *   if (!r.ok) console.log(r.fail.type)      // 'denied', 'timeout', ...
 */
export type FailType =
  | 'threw' | 'timeout' | 'denied' | 'invalid-input' | 'invalid-output' | 'unknown-op' | 'not-unique' | 'not-found'

export type Fail = { type: FailType; reason: string; coord?: string }
export type NanoResult<T> = { ok: true; value: T } | { ok: false; fail: Fail }

export const success = <T>(value: T): NanoResult<T> => ({ ok: true, value })

export const failure = (type: FailType, reason: string, coord?: string): NanoResult<never> => ({
  ok: false,
  fail: coord === undefined ? { type, reason } : { type, reason, coord },
})

export function isNanoResult(v: unknown): v is NanoResult<unknown> {
  if (v === null || typeof v !== 'object') return false
  const r = v as { ok?: unknown; fail?: { type?: unknown; reason?: unknown } | null }
  if (r.ok === true) return 'value' in r
  return r.ok === false && typeof r.fail?.type === 'string' && typeof r.fail.reason === 'string'
}
