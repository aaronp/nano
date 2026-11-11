// A Picker: one choice from a list of options, published as `changed` whenever it changes.
import { Type } from 'typebox'
import { component, event, state } from '@pritzlaff/nano-runes'

const Options = Type.Array(Type.String(), { description: 'The choices', examples: [['slow', 'normal', 'fast']] })
const Config = Type.Object({ options: Options }, { description: 'The settings: the options (the choice is data; it is kept if still an option)', examples: [{ options: ['slow', 'fast'] }] })

/** A choice from `options`. `pick` refuses a value that isn't one; new options keep the value if they still have it. */
export const Picker = component('nano.template/picker', () => {
  const s = state({ options: ['slow', 'normal', 'fast'], value: 'slow' })
  const changed = event(Type.String())
  const set = (v: string) => { if (v !== s.value) { s.value = v; changed(v) } }
  const setOptions = (list: string[]) => { s.options = list; if (!list.includes(s.value)) set(list[0] ?? '') }
  return {
    get options() { return s.options }, get value() { return s.value },
    changed,
    pick: (v: string) => {
      if (!s.options.includes(v)) throw new Error(`${JSON.stringify(v)} is not one of the options (${s.options.join(', ')})`)
      set(v)
    },
    get config() { return { options: s.options } },
    configure: (c: { options: string[] }) => { setOptions(c.options) },
    setOptions,
  }
}, {
  options: Type.Array(Type.String(), { description: 'The choices', examples: [['slow', 'normal', 'fast']] }),
  config: Config,
  configure: { in: Config, description: 'Replaces the settings (the options), keeping the choice if it is still one (else the first)' },
  value: Type.String({ description: 'The current choice', examples: ['slow'] }),
  changed: Type.String({ description: 'The new choice, whenever it changes', examples: ['fast'] }),
  pick: { in: Type.String({ description: 'One of the options', examples: ['normal'] }), description: 'Chooses an option; refuses one that is not in the list' },
  setOptions: { in: Type.Array(Type.String(), { description: 'The new choices', examples: [['red', 'green']] }),
    description: 'Replaces the options, keeping the choice if it is still one (else the first)' },
}, { description: 'One choice from a list of options' })
