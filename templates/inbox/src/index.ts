// The package's entry: what a host imports. `catalog` lists its kinds of component; `define()` defines their elements.
import type { Catalog } from '@pritzlaff/nano-elements'
export { Folders } from './folders'
export { List } from './list'
export { Reader } from './reader'
import { Folders } from './folders'
import { List } from './list'
import { Reader } from './reader'
import { FoldersEl } from './folders-el'
import { ListEl } from './list-el'
import { ReaderEl } from './reader-el'
export { FoldersEl, ListEl, ReaderEl }

/** This package's kinds of component, each with a title and its element's tag. */
export const catalog = {
  folders: { component: Folders, title: 'Folders', tag: 'inbox-folders' },
  list: { component: List, title: 'Message list', tag: 'inbox-list' },
  reader: { component: Reader, title: 'Message reader', tag: 'inbox-reader' },
} satisfies Catalog

/** The elements to define, by tag. */
const ELEMENTS: [string, CustomElementConstructor][] = [
  [catalog.folders.tag, FoldersEl as unknown as CustomElementConstructor],
  [catalog.list.tag, ListEl as unknown as CustomElementConstructor],
  [catalog.reader.tag, ReaderEl as unknown as CustomElementConstructor],
]

/** Defines every element of this package, once (a tag already defined is left alone). */
export function define() {
  for (const [tag, el] of ELEMENTS) if (!customElements.get(tag)) customElements.define(tag, el)
}
