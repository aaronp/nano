// A number between bounds, as a slider sets it. Its value is published whenever it changes.
import { Type } from 'typebox'
import { component, state } from '@pritzlaff/nano-runes'

const ConfigSchema = Type.Object({ min: Type.Number(), max: Type.Number(), step: Type.Number({ exclusiveMinimum: 0 }), value: Type.Number() },
  { description: 'The settings: min < max, step > 0, and the value (clamped into the bounds)', examples: [{ min: 0, max: 10, step: 0.5, value: 4 }] })

/** A bounded number; `set` clamps it into [min, max]. */
export const Range = component('composable.bundle/range', () => {
  const s = state({ value: 50, min: 0, max: 100, step: 1 })
  const bounds = ({ min, max, step }: { min: number; max: number; step: number }, value = s.value) => {
    if (!(min < max) || !(step > 0)) throw new Error('need min < max and step > 0')
    Object.assign(s, { min, max, step, value: Math.min(max, Math.max(min, value)) })
  }
  return {
    get value() { return s.value }, get min() { return s.min }, get max() { return s.max }, get step() { return s.step },
    set: (n: number) => { s.value = Math.min(s.max, Math.max(s.min, n)) },
    setBounds: bounds,
    get config() { return { min: s.min, max: s.max, step: s.step, value: s.value } },
    configure: (c: { min: number; max: number; step: number; value: number }) => { bounds(c, c.value) },
  }
}, {
  value: Type.Number({ description: 'The current value, always within [min, max]', examples: [50] }),
  min: Type.Number({ description: 'The lowest value', examples: [0] }),
  max: Type.Number({ description: 'The highest value', examples: [100] }),
  step: Type.Number({ description: 'How far one notch moves the value', examples: [1] }),
  config: ConfigSchema,
  configure: { in: ConfigSchema, description: 'Replaces the settings; refuses min ≥ max or step ≤ 0, changing nothing' },
  set: { in: Type.Number({ description: 'The new value; clamped into [min, max]', examples: [42] }), description: 'Sets the value, clamped into [min, max]' },
  setBounds: {
    in: Type.Object({ min: Type.Number(), max: Type.Number(), step: Type.Number({ exclusiveMinimum: 0 }) }, { description: 'New bounds: min < max, step > 0', examples: [{ min: 0, max: 10, step: 0.5 }] }),
    description: 'Changes min, max and step, and clamps the value into them; refuses min ≥ max or step ≤ 0',
  },
}, { description: 'A number between bounds, as a slider sets it' })
