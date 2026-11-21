import { Type } from 'typebox'
import { Coord, Schema, Implementation, provide, success } from '@pritzlaff/nano-core'
import { MapIface } from '../interfaces.ts'

const ns = Coord.namespace('nano.ui')

/** `code` is a function body over `x`. A body that does not parse makes `make` throw, so each call fails with `threw`. */
export const map = Implementation.define(ns.implementationId('map'), {
  provides: [MapIface],
  config: Schema.define(Type.Object({ code: Type.String() }, { default: { code: 'return x' } }), 'MapConfig'),   // a picked pod starts as the identity
  make: (_ctx, config: { code: string }) => {
    const fn = new Function('x', config.code) as (x: unknown) => unknown
    return [provide(MapIface, { map: async x => success(fn(x)) })]
  },
})
