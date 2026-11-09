// The package's entry: what a host imports. `catalog` lists its kinds of component; `define()` defines their elements.
import type { Catalog } from '@pritzlaff/nano-elements'
export { Timer } from './timer'
import { Timer } from './timer'

/** This package's kinds of component, each with a title and its element's tag. */
export const catalog = {
  timer: { component: Timer, title: 'Timer', tag: 'nano-timer' },
} satisfies Catalog

/** The elements to define, by tag. */
const ELEMENTS: [string, CustomElementConstructor][] = []

/** Defines every element of this package, once (a tag already defined is left alone). */
export function define() {
  for (const [tag, el] of ELEMENTS) if (!customElements.get(tag)) customElements.define(tag, el)
}
