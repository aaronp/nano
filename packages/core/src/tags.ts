// A two-way index between plain-string tags and items. Data only: a tag means nothing to the index.

/** A tag gained or lost by an item. */
export type TagChange<T> = { item: T; tag: string; added: boolean }

/** Tags items and finds them either way. Tags are trimmed, and 1 to 64 characters long. */
export type Tags<T extends string = string> = {
  /** False if the item already has the tag. */
  tag(item: T, tag: string): boolean
  /** False if the item does not have the tag. */
  untag(item: T, tag: string): boolean
  /** The items with `tag`, as a copy; empty for an unknown tag. */
  tagged(tag: string): ReadonlySet<T>
  /** The tags of `item`, as a copy; empty for an unknown item. */
  tagsOf(item: T): ReadonlySet<string>
  /** Untags everything on `item`, one change per tag. */
  remove(item: T): void
  /** Every item with its tags, for saving. */
  all(): ReadonlyMap<T, ReadonlySet<string>>
  listen(fn: (c: TagChange<T>) => void): () => void
}

const MAX = 64
const clean = (tag: string) => {
  const t = tag.trim()
  if (t === '' || t.length > MAX) throw new Error(`a tag is 1 to ${MAX} characters once trimmed: ${JSON.stringify(tag)}`)
  return t
}
const at = <K, V>(m: Map<K, Set<V>>, k: K) => m.get(k) ?? m.set(k, new Set()).get(k)!

/** Makes an empty index. */
export const Tags = {
  create<T extends string = string>(): Tags<T> {
    const byTag = new Map<string, Set<T>>(), byItem = new Map<T, Set<string>>()
    const listeners = new Set<(c: TagChange<T>) => void>()
    const emit = (c: TagChange<T>) => listeners.forEach(fn => fn(c))
    const untagOne = (item: T, tag: string) => {
      const items = byTag.get(tag), tags = byItem.get(item)
      if (!items?.has(item) || !tags) return false
      items.delete(item); if (!items.size) byTag.delete(tag)
      tags.delete(tag); if (!tags.size) byItem.delete(item)
      emit({ item, tag, added: false })
      return true
    }
    return {
      tag(item, tag) {
        const t = clean(tag)
        if (byItem.get(item)?.has(t)) return false
        at(byTag, t).add(item); at(byItem, item).add(t)
        emit({ item, tag: t, added: true })
        return true
      },
      untag: (item, tag) => untagOne(item, tag.trim()),
      tagged: tag => new Set(byTag.get(tag.trim())),
      tagsOf: item => new Set(byItem.get(item)),
      remove(item) {
        for (const tag of [...(byItem.get(item) ?? [])]) untagOne(item, tag)
      },
      all: () => new Map([...byItem].map(([item, tags]) => [item, new Set(tags)])),
      listen(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    }
  },
}
