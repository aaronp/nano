import type { TSchema } from 'typebox'
import { fail, type Input, type Op, type Result, type SystemInstance } from '@composable/sdk'

/** Call one of `component`'s own ops through its handle. Never throws: a throw or a missing System is a failed Result. */
export async function act<P extends Op<TSchema, TSchema | undefined>>(component: { systems: readonly SystemInstance[] }, op: P, input: Input<P>): Promise<Result<unknown>> {
  const h = component.systems[0]
  if (!h) return fail('unavailable', 'not in a System')
  try { return await h.call(h.instanceId, op, input) } catch (e) { return fail('handler', String((e as Error)?.message ?? e)) }
}

/** A failed Result as text; '' for success. */
export const problemOf = (r: Result<unknown>) => r.type === 'success' ? '' : r.type === 'error' ? r.error.message : r.reason
