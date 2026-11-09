// A number between bounds, as a slider sets it. Its value is published whenever it changes.
import { Type } from 'typebox'
import { component, state } from '@composable/runes'

/** A bounded number; `set` clamps it into [min, max]. */
export const Range = component('composable.bundle/range', () => {
  const s = state({ value: 50, min: 0, max: 100, step: 1 })
  return {
    get value() { return s.value }, get min() { return s.min }, get max() { return s.max }, get step() { return s.step },
    set: (n: number) => { s.value = Math.min(s.max, Math.max(s.min, n)) },
    setBounds: ({ min, max, step }: { min: number; max: number; step: number }) => {
      if (!(min < max) || !(step > 0)) throw new Error('need min < max and step > 0')
      Object.assign(s, { min, max, step, value: Math.min(max, Math.max(min, s.value)) })
    },
  }
}, { value: Type.Number(), set: Type.Number(), setBounds: Type.Object({ min: Type.Number(), max: Type.Number(), step: Type.Number() }) })
