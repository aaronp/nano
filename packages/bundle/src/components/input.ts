// One value and a submit: what the user typed (or ticked), published when they submit it.
import { Type } from 'typebox'
import { component, event, state } from '@pritzlaff/nano-runes'

/** The kinds of input: a line of text, a text area, a number or a checkbox. */
export type Kind = 'text' | 'textarea' | 'number' | 'boolean'

/** A single input; `submit` publishes its value as `submitted`. */
export const Input = component('composable.bundle/input', () => {
  const s = state({ kind: 'text' as Kind, value: '' as unknown })
  const submitted = event()
  return {
    get kind() { return s.kind },
    get value() { return s.value },
    submitted,
    setKind: (k: Kind) => { s.kind = k },
    setValue: (v: unknown) => { s.value = v },
    submit: () => { submitted(s.value) },
  }
}, { setKind: Type.Union([Type.Literal('text'), Type.Literal('textarea'), Type.Literal('number'), Type.Literal('boolean')]) })
