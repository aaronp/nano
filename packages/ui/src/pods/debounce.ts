import { Type } from 'typebox'
import { Coord, Schema, Implementation, provide, success } from '@pritzlaff/nano-core'
import { Clock, Debounce } from '../interfaces.ts'

const ns = Coord.namespace('nano.ui')
const Ms = Type.Integer({ minimum: 0, maximum: 60000 })

/**
 * `push` returns at once and queues its value. After `quietMs` without a push, or at the latest `maxWaitMs` after the
 * first push of a batch (when set), the queue flushes: the newest value as `flushed`, all of it, oldest first, as `batch`.
 */
export const debounce = Implementation.define(ns.implementationId('debounce'), {
  provides: [Debounce],
  config: Schema.define(Type.Union([Type.Object({ quietMs: Ms, maxWaitMs: Type.Optional(Ms) }), Type.Undefined()]), 'DebounceConfig'),
  dependencies: { clock: Clock },
  make: (ctx, config?: { quietMs: number; maxWaitMs?: number }) => {
    const quietMs = config?.quietMs ?? 300, maxWaitMs = config?.maxWaitMs
    let queue: unknown[] = [], closed = false
    // Two timers, 'quiet' and 'max', on the wired clock when exactly one is wired (chosen once, here), else on real time.
    const slots: Record<string, number | ReturnType<typeof setTimeout>> = {}
    let pushes: Promise<unknown> = Promise.resolve()   // on the clock, pushes run one at a time: no overlapping after/cancel
    const wired = ctx.one(Clock)
    const clear = (tag: string) => {
      const s = slots[tag]; delete slots[tag]
      if (s === undefined) return
      if (wired.ok) void wired.value.call.cancel(s as number); else clearTimeout(s as ReturnType<typeof setTimeout>)
    }
    const start = async (tag: string, ms: number) => {
      if (!wired.ok) { slots[tag] = setTimeout(flush, ms); return }
      const r = await wired.value.call.after({ ms, tag })
      if (!r.ok) return
      if (closed) void wired.value.call.cancel(r.value); else slots[tag] = r.value
    }
    const flush = () => {
      clear('quiet'); clear('max')
      const batch = queue; queue = []
      if (closed || batch.length === 0) return
      void ctx.publish(Debounce.ops.flushed, batch.at(-1))
      void ctx.publish(Debounce.ops.batch, batch)
    }
    if (wired.ok) wired.value.on(Clock.ops.fired, ({ output }) => {   // only our own timers: the id in our slot
      if (output.tag && slots[output.tag] === output.id) { delete slots[output.tag]; flush() }
    })
    ctx.addOnCloseListener(() => { closed = true; clear('quiet'); clear('max') })
    return [provide(Debounce, {
      push: value => {
        const run = async () => {
          if (closed) return success(null)
          queue.push(value)
          clear('quiet'); await start('quiet', quietMs)
          if (maxWaitMs !== undefined && slots.max === undefined) await start('max', maxWaitMs)
          return success(null)
        }
        return wired.ok ? (pushes = pushes.then(run, run)) as ReturnType<typeof run> : run()
      },
    })]
  },
})
