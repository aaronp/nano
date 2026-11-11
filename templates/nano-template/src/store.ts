// A Store: key/value pairs kept in the storage of the origin it runs in, so where it runs decides what it shares.
// In the host page (or a same-origin sandbox) that is the host's localStorage; an isolated sandbox has no storage,
// so it keeps them in memory; a component served from its own domain would keep them in that domain's storage.
import { Type } from 'typebox'
import { component, event, state } from '@pritzlaff/nano-runes'

const PREFIX = 'nano.template/store:'

/** This origin's localStorage, or nothing where it is denied (an opaque origin throws on access). */
function originStorage(): Storage | undefined {
  try { const s = globalThis.localStorage; void s.length; return s } catch { return undefined }
}

const load = (s: Storage | undefined): Record<string, string> => {
  const out: Record<string, string> = {}
  for (let i = 0; s && i < s.length; i++) {
    const k = s.key(i)
    if (k?.startsWith(PREFIX)) Object.defineProperty(out, k.slice(PREFIX.length), { value: s.getItem(k) ?? '', enumerable: true, writable: true, configurable: true })
  }
  return out
}
// own properties only, so a key like __proto__ or toString is an ordinary entry
const without = (o: Record<string, string>, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key))

/** Key/value pairs. Every store in one origin shares them (a later store sees what an earlier one set). */
export const Store = component('nano.template/store', () => {
  const storage = originStorage()
  const s = state({ entries: load(storage) })
  const changed = event(Type.Object({ key: Type.String(), value: Type.Union([Type.String(), Type.Null()]) }))
  const write = (key: string, value: string | null) => {
    s.entries = value === null ? without(s.entries, key) : Object.fromEntries([...Object.entries(without(s.entries, key)), [key, value]])
    if (value === null) storage?.removeItem(PREFIX + key); else storage?.setItem(PREFIX + key, value)
    changed({ key, value })
  }
  return {
    get entries() { return s.entries },
    get backing() { return storage ? 'localStorage' : 'memory' },
    changed,
    get: (key: string): string | null => (Object.hasOwn(s.entries, key) ? s.entries[key]! : null),
    set: (e: { key: string; value: string }) => { write(e.key, e.value) },
    remove: (key: string) => { if (Object.hasOwn(s.entries, key)) write(key, null) },
  }
}, {
  entries: Type.Record(Type.String(), Type.String(), { description: 'Every key and its value', examples: [{ theme: 'dark' }] }),
  backing: Type.Union([Type.Literal('localStorage'), Type.Literal('memory')], { description: "Where values are kept: this origin's localStorage, or memory where there is none (an isolated sandbox)", examples: ['localStorage'] }),
  changed: Type.Object({ key: Type.String(), value: Type.Union([Type.String(), Type.Null()]) },
    { description: 'A key that was set (its new value) or removed (null)', examples: [{ key: 'theme', value: 'dark' }] }),
  get: { in: Type.String({ minLength: 1, maxLength: 200, description: 'The key', examples: ['theme'] }),
    out: Type.Union([Type.String(), Type.Null()], { description: 'Its value, or null if never set', examples: ['dark'] }), description: 'Reads the value of a key' },
  set: { in: Type.Object({ key: Type.String({ minLength: 1, maxLength: 200, description: 'The key', examples: ['theme'] }), value: Type.String({ maxLength: 10_000, description: 'The value', examples: ['dark'] }) }),
    description: 'Stores a value under a key, replacing any before' },
  remove: { in: Type.String({ minLength: 1, maxLength: 200, description: 'The key', examples: ['theme'] }), description: 'Deletes a key (nothing happens for one not set)' },
}, { description: "Key/value pairs kept in the storage of the origin it runs in" })
