// An element that places its own component: by its `name`, in the registry provided for its document.
import { Components, type Component, type Registry } from '@composable/core'
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
  #owned = false

  connectedCallback() {
    this.registry ??= providedRegistry(this.ownerDocument)
    this.model ??= this.getAttribute('name') ?? `${this.localName}-${n++}`
    const reg = this.registry
    if (reg && !reg.get(this.model)) {
      const r = reg.add(this.model, Components.instantiate((this.constructor as typeof PlacedElement).component))
      this.#owned = !('error' in r)
    }
    super.connectedCallback()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    // wait a moment: moving the element (as a dock does) disconnects and reconnects it, and keeps the instance
    queueMicrotask(() => {
      if (this.isConnected || !this.#owned || !this.model) return
      this.registry?.remove(this.model)
      this.#owned = false
    })
  }
}
