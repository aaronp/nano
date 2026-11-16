import { Type } from 'typebox'
import { Schema, Implementation, provide, success } from '@pritzlaff/nano-core'
import { MapIface } from '../interfaces.ts'

/** `code` is a function body over `x`. A body that does not parse makes `make` throw, so each call fails with `threw`. */
export const map = Implementation.define('nano.ui/map', {
  provides: [MapIface],
  config: Schema.define(Type.Object({ code: Type.String() }), 'MapConfig'),
  make: (_ctx, config: { code: string }) => {
    const fn = new Function('x', config.code) as (x: unknown) => unknown
    return [provide(MapIface, { map: async x => success(fn(x)) })]
  },
})
