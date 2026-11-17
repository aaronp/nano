import { Type } from 'typebox'
import { Coord, Schema, Implementation, provide, success } from '@pritzlaff/nano-core'
import { Log } from '../interfaces.ts'

const ns = Coord.namespace('nano.ui')

/** Keeps the newest `max` entries (default 100). */
export const log = Implementation.define(ns.implementationId('log'), {
  provides: [Log],
  config: Schema.define(Type.Union([Type.Object({ max: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })) }), Type.Undefined()]), 'LogConfig'),
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
