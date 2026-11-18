import { Type } from 'typebox'
import { Coord, Schema, Implementation, provide, success } from '@pritzlaff/nano-core'
import { Random } from '../interfaces.ts'

const ns = Coord.namespace('nano.ui')

/** The real random: `next` is Math.random. */
export const random = Implementation.define(ns.implementationId('random'), {
  provides: [Random],
  make: () => [provide(Random, { next: async () => success(Math.random()) })],
})

/** A seeded random (mulberry32): the same seed gives the same sequence, and a restart begins it again. */
export const seededRandom = Implementation.define(ns.implementationId('seeded-random'), {
  provides: [Random],
  config: Schema.define(Type.Union([Type.Object({ seed: Type.Optional(Type.Integer()) }), Type.Undefined()]), 'SeededRandomConfig'),
  make: (ctx, config?: { seed?: number }) => {
    let s = (config?.seed ?? 1) >>> 0
    return [provide(Random, { next: async () => {
      s = (s + 0x6d2b79f5) >>> 0
      let t = Math.imul(s ^ (s >>> 15), s | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return success(((t ^ (t >>> 14)) >>> 0) / 4294967296)
    } })]
  },
})
