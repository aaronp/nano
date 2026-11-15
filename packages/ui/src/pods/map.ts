import { Type } from 'typebox'
import { defineSchema, implementation, provide, success } from '@pritzlaff/nano'
import { MapIface } from '../interfaces.ts'

/** `code` is a function body over `x`. A body that does not parse makes `make` throw, so each call fails with `threw`. */
export const map = implementation('nano.ui/map', {
  provides: [MapIface],
  config: defineSchema('MapConfig', Type.Object({ code: Type.String() })),
  make: (_ctx, config: { code: string }) => {
    const fn = new Function('x', config.code) as (x: unknown) => unknown
    return [provide(MapIface, { map: async x => success(fn(x)) })]
  },
})
