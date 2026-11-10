// A Picker: one choice from a list of options, published as `changed` whenever it changes.
import { Type } from 'typebox'
import { component, event, state } from '@pritzlaff/nano-runes'

/** A choice from `options`. `pick` refuses a value that isn't one; new options keep the value if they still have it. */
export const Picker = component('nano.template/picker', () => {
  const s = state({ options: ['slow', 'normal', 'fast'], value: 'slow' })
  const changed = event(Type.String())
  const set = (v: string) => { if (v !== s.value) { s.value = v; changed(v) } }
  return {
    get options() { return s.options }, get value() { return s.value },
    changed,
    pick: (v: string) => {
      if (!s.options.includes(v)) throw new Error(`${JSON.stringify(v)} is not one of the options (${s.options.join(', ')})`)
      set(v)
    },
    setOptions: (list: string[]) => { s.options = list; if (!list.includes(s.value)) set(list[0] ?? '') },
  }
}, {
  options: Type.Array(Type.String(), { description: 'The choices', examples: [['slow', 'normal', 'fast']] }),
  value: Type.String({ description: 'The current choice', examples: ['slow'] }),
  changed: Type.String({ description: 'The new choice, whenever it changes', examples: ['fast'] }),
  pick: { in: Type.String({ description: 'One of the options', examples: ['normal'] }), description: 'Chooses an option; refuses one that is not in the list' },
  setOptions: { in: Type.Array(Type.String(), { description: 'The new choices', examples: [['red', 'green']] }),
    description: 'Replaces the options, keeping the choice if it is still one (else the first)' },
}, { description: 'One choice from a list of options' })
