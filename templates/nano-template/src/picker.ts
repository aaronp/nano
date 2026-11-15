import { Type } from 'typebox'
import { defineSchema, implementation, provide, success } from '@pritzlaff/nano-core'
import { Picker } from './interfaces.ts'

export const OPTIONS = ['red', 'green', 'blue']

/** One choice from a list. `pick` publishes `changed` as `{ key: 'choice', value }`. Config: `{ options }`. */
export const picker = implementation('acme.template/picker', {
  provides: [Picker],
  config: defineSchema('PickerConfig', Type.Union([Type.Object({ options: Type.Array(Type.String()) }), Type.Undefined()])),
  make: (ctx, _config?: { options: string[] }) => [provide(Picker, {
    pick: async value => { await ctx.publish(Picker.ops.changed, { key: 'choice', value }); return success(null) },
    // ponytail: the view lists the configured options and this pod holds none, so setOptions is a no-op until an `options` action shows them.
    setOptions: async () => success(null),
  })],
})
