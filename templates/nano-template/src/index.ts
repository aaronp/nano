// The package's entry: what a host imports. `catalog` lists its kinds of component; `define()` defines their elements.
import type { Catalog } from '@pritzlaff/nano-elements'
export { Timer } from './timer'
export { Picker } from './picker'
export { Store } from './store'
import { Timer } from './timer'
import { Picker } from './picker'
import { Store } from './store'
import { TimerEl } from './timer-el'
import { PickerEl } from './picker-el'
import { StoreEl } from './store-el'
export { TimerEl, PickerEl, StoreEl }

/** This package's kinds of component, each with a title and its element's tag. */
export const catalog = {
  timer: { component: Timer, title: 'Timer', tag: 'nano-timer' },
  picker: { component: Picker, title: 'Picker', tag: 'nano-picker' },
  store: { component: Store, title: 'Store', tag: 'nano-store' },
} satisfies Catalog

/** The elements to define, by tag. */
const ELEMENTS: [string, CustomElementConstructor][] = [
  [catalog.timer.tag, TimerEl as unknown as CustomElementConstructor],
  [catalog.picker.tag, PickerEl as unknown as CustomElementConstructor],
  [catalog.store.tag, StoreEl as unknown as CustomElementConstructor],
]

/** Defines every element of this package, once (a tag already defined is left alone). */
export function define() {
  for (const [tag, el] of ELEMENTS) if (!customElements.get(tag)) customElements.define(tag, el)
}
