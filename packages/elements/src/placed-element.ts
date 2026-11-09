// An element that places its own component: by its `name`, in the registry provided for its document.
import { Components, type Component, type Instance, type Registry } from '@composable/core'
import { ModelElement } from './model-element'

const provided = new WeakMap<Document, Registry>()
let n = 0

/** Sets the registry that placed elements in `doc` use. */
export const provide = (doc: Document, registry: Registry) => { provided.set(doc, registry) }
/** The registry provided for `doc`, if any. */
export const providedRegistry = (doc: Document) => provided.get(doc)

/**
 * A ModelElement that brings its own component (`static component`). On the page it shows the instance named by
 * its `name` attribute, creating it if it doesn't exist; an instance it created goes when the element does.
 */
export abstract class PlacedElement extends ModelElement {
  static component: Component
  /** The instance this element made, and where: only that one is ever removed by it. */
  #mine?: { id: string; inst: Instance; registry: Registry }

  connectedCallback() {
    this.registry ??= providedRegistry(this.ownerDocument)
    this.model ??= this.getAttribute('name') ?? `${this.localName}-${n++}`
    const reg = this.registry
    if (reg && !reg.get(this.model)) {
      const inst = Components.instantiate((this.constructor as typeof PlacedElement).component)
      if (!('error' in reg.add(this.model, inst))) this.#mine = { id: this.model, inst, registry: reg }
    }
    super.connectedCallback()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    // wait a moment: moving the element (as a dock does) disconnects and reconnects it, and keeps the instance
    queueMicrotask(() => {
      const mine = this.#mine
      if (this.isConnected || !mine) return
      if (mine.registry.get(mine.id) === mine.inst) mine.registry.remove(mine.id)   // not one that replaced it
      this.#mine = undefined
    })
  }
}
