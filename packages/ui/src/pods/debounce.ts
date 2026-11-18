import { Type } from 'typebox'
import { Coord, Schema, Implementation, provide, success } from '@pritzlaff/nano-core'
import { Debounce } from '../interfaces.ts'

const ns = Coord.namespace('nano.ui')
const Ms = Type.Integer({ minimum: 0, maximum: 60000 })

/**
 * `push` returns at once and queues its value. After `quietMs` without a push, or at the latest `maxWaitMs` after the
 * first push of a batch (when set), the queue flushes: the newest value as `flushed`, all of it, oldest first, as `batch`.
 */
export const debounce = Implementation.define(ns.implementationId('debounce'), {
  provides: [Debounce],
  config: Schema.define(Type.Union([Type.Object({ quietMs: Ms, maxWaitMs: Type.Optional(Ms) }), Type.Undefined()]), 'DebounceConfig'),
  make: (ctx, config?: { quietMs: number; maxWaitMs?: number }) => {
    const quietMs = config?.quietMs ?? 300, maxWaitMs = config?.maxWaitMs
    let quiet: ReturnType<typeof setTimeout> | undefined, max: ReturnType<typeof setTimeout> | undefined
    let queue: unknown[] = [], closed = false
    const flush = () => {
      clearTimeout(quiet); clearTimeout(max); max = undefined
      const batch = queue; queue = []
      if (closed || batch.length === 0) return
      void ctx.publish(Debounce.ops.flushed, batch.at(-1))
      void ctx.publish(Debounce.ops.batch, batch)
    }
    ctx.addOnCloseListener(() => { closed = true; clearTimeout(quiet); clearTimeout(max) })
    return [provide(Debounce, {
      push: async value => {
        if (closed) return success(null)
        queue.push(value)
        clearTimeout(quiet); quiet = setTimeout(flush, quietMs)
        if (maxWaitMs !== undefined) max ??= setTimeout(flush, maxWaitMs)
        return success(null)
      },
    })]
  },
})
