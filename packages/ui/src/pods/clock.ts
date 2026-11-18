import { Coord, Implementation, provide, success } from '@pritzlaff/nano-core'
import { Clock } from '../interfaces.ts'

const ns = Coord.namespace('nano.ui')

/** The real clock: `now` is Date.now, `after` is setTimeout, and `fired` is published when the timer is due. */
export const clock = Implementation.define(ns.implementationId('clock'), {
  provides: [Clock],
  make: ctx => {
    const timers = new Map<number, ReturnType<typeof setTimeout>>()
    let next = 0, closed = false
    ctx.addOnCloseListener(() => { closed = true; timers.forEach(clearTimeout); timers.clear() })
    return [provide(Clock, {
      now: async () => success(Date.now()),
      after: async ({ ms, tag }) => {
        const id = ++next
        timers.set(id, setTimeout(() => {
          timers.delete(id)
          if (!closed) void ctx.publish(Clock.ops.fired, { id, ...(tag === undefined ? {} : { tag }), at: Date.now() })
        }, ms))
        return success(id)
      },
      cancel: async id => { clearTimeout(timers.get(id)); timers.delete(id); return success(null) },
    })]
  },
})
