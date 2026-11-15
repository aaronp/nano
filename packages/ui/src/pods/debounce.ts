import { Type } from 'typebox'
import { defineSchema, implementation, provide, success } from '@pritzlaff/nano'
import { Debounce } from '../interfaces.ts'

/** `push` returns at once; after `quietMs` without a push, the last value is published as `flushed`. */
export const debounce = implementation('nano.ui/debounce', {
  provides: [Debounce],
  config: defineSchema('DebounceConfig', Type.Union([Type.Object({ quietMs: Type.Integer({ minimum: 0, maximum: 60000 }) }), Type.Undefined()])),
  make: (ctx, config?: { quietMs: number }) => {
    const quietMs = config?.quietMs ?? 300
    let timer: ReturnType<typeof setTimeout> | undefined
    ctx.addOnCloseListener(() => clearTimeout(timer))
    return [provide(Debounce, {
      push: async value => {
        clearTimeout(timer)
        timer = setTimeout(() => { void ctx.publish(Debounce.ops.flushed, value) }, quietMs)
        return success(null)
      },
    })]
  },
})
