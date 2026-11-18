/**
 * The drift case study: `example.drift/form` declares `submit → store.put`, but its code also clears a draft with
 * `store.delete`. The workspace observer flags that call as seen, not declared; Reconcile writes it onto the edge.
 *
 *   await app.runtime('example.drift.main').get(FormDef.api).submit('hi')
 */
import { Type } from 'typebox'
import { Coord, Implementation, Op } from '@pritzlaff/nano-core'
import { KeyValueStoreDef } from '../kv/contract.ts'

export namespace FormDef {
  export const ns = Coord.namespace('example.drift')
  export const api = ns.interface('Form', { submit: Op.action(Type.String(), Type.Null()) })
}

const form = Implementation.define(FormDef.ns.implementationId('form'), {
  provides: [FormDef.api],
  description: 'Saves what is submitted; declares only the save, but also clears the draft.',
  dependencies: { store: KeyValueStoreDef.api },
  calls: { submit: { store: [KeyValueStoreDef.api.ops.put] } },
  make: () => ({
    async submit(text, c) {
      await c!.deps.store.put({ key: ['submitted', crypto.randomUUID()], value: text })
      await c!.deps.store.delete(['draft'])   // the drift: not in `calls`
    },
  }),
})

export default FormDef.ns.provider([form])
