import { Type } from 'typebox'
import { Coord, Schema, Implementation, provide, success } from '@pritzlaff/nano-core'
import { Timer } from './interfaces.ts'

const ns = Coord.namespace('acme.template')

/** Counts while started and publishes each count as `tick`. Config: `{ intervalMs }` (default 1000). */
// #region timer-implementation
export const timer = Implementation.define(ns.implementationId('timer'), {
  provides: [Timer],
  config: Schema.define(Type.Union([Type.Object({ intervalMs: Type.Integer({ minimum: 5, maximum: 60000 }) }), Type.Undefined()]), 'TimerConfig'),
  make: (ctx, config?: { intervalMs: number }) => {
    let clock: ReturnType<typeof setInterval> | undefined, count = 0
    const stop = () => { clearInterval(clock); clock = undefined }
    ctx.addOnCloseListener(stop)
    return [provide(Timer, {
      start: async () => {
        clock ??= setInterval(() => { count += 1; void ctx.publish(Timer.ops.tick, { key: 'tick', value: String(count) }) }, config?.intervalMs ?? 1000)
        return success(null)
      },
      stop: async () => { stop(); return success(null) },
    })]
  },
})
// #endregion timer-implementation
