import { Coord, Implementation, provide, success } from '@pritzlaff/nano-core'
import { Store } from './interfaces.ts'

const ns = Coord.namespace('acme.template')

const PREFIX = 'acme.template:'
/** The origin's localStorage, or undefined where there is none (or it throws, as in a sandboxed frame). */
const local = (): Storage | undefined => { try { return globalThis.localStorage } catch { return undefined } }

/** Key/value text in `localStorage`, or in memory when there is none. Publishes `changed` with the key. */
export const store = Implementation.define(ns.implementationId('store'), {
  provides: [Store],
  make: ctx => {
    const ls = local(), mem = new Map<string, string>()
    const read = (k: string) => ls ? ls.getItem(PREFIX + k) : mem.get(k) ?? null
    const changed = async (k: string) => { await ctx.publish(Store.ops.changed, k); return success(null) }
    return [provide(Store, {
      get: async k => success(read(k)),
      // #region store-set
      set: async ({ key, value }) => { if (ls) ls.setItem(PREFIX + key, value); else mem.set(key, value); return changed(key) },
      // #endregion store-set
      remove: async k => { if (ls) ls.removeItem(PREFIX + k); else mem.delete(k); return changed(k) },
      entries: async () => success(Object.fromEntries(ls
        ? Object.keys(ls).filter(k => k.startsWith(PREFIX)).map(k => [k.slice(PREFIX.length), ls.getItem(k)!])
        : mem)),
    })]
  },
})
