// The form's logic: check what was typed (before any traffic), then save it through the bff.
import { Type } from 'typebox'
import type { Clients } from '@pritzlaff/nano-core'
import { component, state } from '@pritzlaff/nano-runes'
import { Bff, Outcome, Stored, Validation } from './interfaces'

export const PersonForm = component('composable.people/person-form', ({ bff, rules }: Clients<{ bff: typeof Bff; rules: typeof Validation }>) => {
  const s = state({ people: [] as Stored[] })
  const refresh = async () => { s.people = await bff.listPersons(null) }
  return {
    get people() { return s.people },
    async submit(input: unknown) {
      const checked = await rules.check(input)   // fail fast, before any traffic
      if (!checked.ok) return checked
      const saved = await bff.save(checked.value)
      if (saved.ok) await refresh()
      return saved
    },
    lookup: (name: string) => bff.lookup(name),
    refresh,
  }
}, {
  people: Type.Array(Stored, { description: 'Everyone saved, as of the last refresh' }),
  submit: { in: Type.Unknown({ description: 'What the user typed' }), out: Outcome(Type.String()), description: 'Checks a person and saves it: its id, or why not' },
  lookup: { in: Type.String({ description: 'A name' }), out: Outcome(Type.String()), description: "Finds a person's id by name" },
  refresh: { description: 'Reads everyone saved again' },
}, { needs: { bff: Bff, rules: Validation }, description: 'A form to save a person, and the people saved' })
