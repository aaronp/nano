import { Type } from 'typebox'
import { defineSchema, implementation, provide, success } from '@pritzlaff/nano-core'
import { Log } from '../interfaces.ts'

/** Keeps the newest `max` entries (default 100). */
export const log = implementation('nano.ui/log', {
  provides: [Log],
  config: defineSchema('LogConfig', Type.Union([Type.Object({ max: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })) }), Type.Undefined()])),
  make: (_ctx, config?: { max?: number }) => {
    const max = config?.max ?? 100
    let entries: unknown[] = []
    return [provide(Log, {
      log: async v => { entries = [...entries, v].slice(-max); return success(null) },
      entries: async () => success([...entries]),
      clear: async () => { entries = []; return success(null) },
    })]
  },
})
