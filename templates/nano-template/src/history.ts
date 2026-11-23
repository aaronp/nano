import type { Static } from 'typebox'
import { Coord } from '@pritzlaff/nano-core'
import { History, type Calculated } from './interfaces.ts'

const ns = Coord.namespace('acme.template')

const KEY = 'acme.template:history'
/** The origin's localStorage, or undefined where there is none (or it throws, as in a sandboxed frame). */
const local = (): Storage | undefined => { try { return globalThis.localStorage ?? undefined } catch { return undefined } }

/** The calculations saved, oldest first, in `localStorage` (memory where there is none). */
// #region history
export const history = History.impl(ns.implementationId('history')).make(() => {
  const ls = local()
  let memory: Static<typeof Calculated>[] = []
  const load = () => ls ? JSON.parse(ls.getItem(KEY) ?? '[]') as typeof memory : memory
  return {
    async save(c) {
      const all = [...load(), c]
      if (ls) ls.setItem(KEY, JSON.stringify(all)); else memory = all
    },
    async load() { return load() },
  }
})
// #endregion history
