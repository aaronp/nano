import { Type } from 'typebox'
import { Coord, Schema, Implementation, provide, success, failure } from '@pritzlaff/nano-core'
import { Clock, ClockControl } from '../interfaces.ts'

const ns = Coord.namespace('nano.ui')

/** A clock that moves only by `advance` and `set`, firing due timers in due order (ties in start order), one at a time. */
export const simClock = Implementation.define(ns.implementationId('sim-clock'), {
  provides: [Clock, ClockControl],
  config: Schema.define(Type.Union([Type.Object({ start: Type.Optional(Type.Number()) }), Type.Undefined()]), 'SimClockConfig'),
  make: (ctx, config?: { start?: number }) => {
    let time = config?.start ?? 0, next = 0
    let queue: Promise<unknown> = Promise.resolve()   // control calls run one at a time, so time never moves back mid-publish
    const run = <T>(f: () => Promise<T>) => (queue = queue.then(f, f)) as Promise<T>
    let timers: { id: number; due: number; tag?: string }[] = []   // ids rise with start order, so (due, id) is the firing order
    const moveTo = async (t: number) => {
      for (;;) {
        const due = timers.filter(x => x.due <= t).sort((a, b) => a.due - b.due || a.id - b.id)[0]
        if (!due) break
        timers = timers.filter(x => x !== due)
        time = due.due
        const { id, tag } = due
        await ctx.publish(Clock.ops.fired, { id, ...(tag === undefined ? {} : { tag }), at: time })
      }
      time = t
      return success(null)
    }
    const set = (t: number) => run(async () => t < time ? failure('invalid-input', `the clock is at ${time}; it cannot go back to ${t}`) : await moveTo(t))
    return [
      provide(Clock, {
        now: async () => success(time),
        after: async ({ ms, tag }) => { const id = ++next; timers.push({ id, due: time + ms, ...(tag === undefined ? {} : { tag }) }); return success(id) },
        cancel: async id => { timers = timers.filter(x => x.id !== id); return success(null) },
      }),
      provide(ClockControl, {
        advance: ms => run(async () => ms < 0 ? failure('invalid-input', `cannot advance by ${ms}`) : moveTo(time + ms)),
        set,
      }),
    ]
  },
})
