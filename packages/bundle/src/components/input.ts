// One value and a submit: what the user typed (or ticked), published when they submit it.
import { Type } from 'typebox'
import { component, event, state } from '@pritzlaff/nano-runes'

/** The kinds of input: a line of text, a text area, a number or a checkbox. */
export type Kind = 'text' | 'textarea' | 'number' | 'boolean'

const KindSchema = Type.Union([Type.Literal('text'), Type.Literal('textarea'), Type.Literal('number'), Type.Literal('boolean')],
  { description: 'A line of text, a text area, a number or a checkbox', examples: ['text', 'number'] })

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
}, {
  kind: KindSchema,
  value: Type.Unknown({ description: 'What is typed or ticked now: text, a number or a boolean, by kind', examples: ['hello', 42, true] }),
  submitted: Type.Unknown({ description: 'The value, published when the user submits it', examples: ['hello', 42] }),
  setKind: { in: KindSchema, description: 'Changes what kind of input it is' },
  setValue: { in: Type.Unknown({ description: 'The new value', examples: ['hello', 42, true] }), description: 'Sets the value, as if typed' },
  submit: { description: 'Publishes the current value as submitted' },
}, { description: 'One value and a submit: what the user typed, published when they submit it' })
