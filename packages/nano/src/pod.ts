/**
 * Pods: a description of one component, as plain data — an implementation's coordinate, its config, and whether it is
 * built as soon as it is in an application (eager) or on its first call (lazy). No state, methods or instance.
 *
 *   Pod.lazy(counter, { config: { start: 0 } })   // { implementation: 'acme/counter', config: { start: 0 }, eager: false }
 *   Pod.eager(ticker)                             // { implementation: 'acme/ticker', eager: true }
 */
import type { Implementation } from './implementation.ts'

export type Pod = { implementation: string; config?: unknown; eager: boolean }

const describe = (eager: boolean) => (impl: Implementation, opts: { config?: unknown } = {}): Pod =>
  ({ implementation: impl.coord, ...(opts.config !== undefined && { config: opts.config }), eager })

export const Pod = { lazy: describe(false), eager: describe(true) }
