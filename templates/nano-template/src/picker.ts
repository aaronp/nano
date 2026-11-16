import { Type } from 'typebox'
import { Coord, Schema, failure, Implementation, provide, success } from '@pritzlaff/nano-core'
import { Picker } from './interfaces.ts'

const ns = Coord.namespace('acme.template')

export const OPTIONS = ['red', 'green', 'blue']

/** One choice from a list. `pick` publishes `changed` as `{ key: 'choice', value }`; a value not in the options fails. Config: `{ options }`. */
export const picker = Implementation.define(ns.implementationId('picker'), {
  provides: [Picker],
  config: Schema.define(Type.Union([Type.Object({ options: Type.Array(Type.String()) }), Type.Undefined()]), 'PickerConfig'),
  make: (ctx, config?: { options: string[] }) => {
    let options = config?.options ?? OPTIONS
    return [provide(Picker, {
      pick: async value => {
        if (!options.includes(value)) return failure('invalid-input', `${value} is not one of ${options.join(', ')}`)
        await ctx.publish(Picker.ops.changed, { key: 'choice', value })
        return success(null)
      },
      setOptions: async list => { options = [...list]; return success(null) },
      options: async () => success([...options]),
    })]
  },
})
