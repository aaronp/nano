import { Type } from 'typebox'
import { Coord, Schema, Implementation, provide, success } from '@pritzlaff/nano-core'
import { Debounce } from '../interfaces.ts'

const ns = Coord.namespace('nano.ui')

/** `push` returns at once; after `quietMs` without a push, the last value is published as `flushed`. */
export const debounce = Implementation.define(ns.implementationId('debounce'), {
  provides: [Debounce],
  config: Schema.define(Type.Union([Type.Object({ quietMs: Type.Integer({ minimum: 0, maximum: 60000 }) }), Type.Undefined()]), 'DebounceConfig'),
  make: (ctx, config?: { quietMs: number }) => {
    const quietMs = config?.quietMs ?? 300
    let timer: ReturnType<typeof setTimeout> | undefined
    let closed = false
    ctx.addOnCloseListener(() => { closed = true; clearTimeout(timer) })
    return [provide(Debounce, {
      push: async value => {
        if (closed) return success(null)
        clearTimeout(timer)
        timer = setTimeout(() => { void ctx.publish(Debounce.ops.flushed, value) }, quietMs)
        return success(null)
      },
    })]
  },
})
