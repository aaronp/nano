import { LitElement, type PropertyValues } from 'lit'
import type { Component } from '@composable/sdk'

type Observable = Component & { onChange?(fn: () => void): () => void }

/**
 * Base for a view element. Set `.component` as a property (`<x-view .component=${c}>` in a template);
 * the view re-renders whenever the component reports a change. Any number of views can share one component.
 */
export class View<C extends Component = Component> extends LitElement {
  static properties = { component: { attribute: false } }
  declare component: C
  #off?: () => void
  #watch() { this.#off?.(); this.#off = (this.component as Observable | undefined)?.onChange?.(() => this.requestUpdate()) }
  override connectedCallback() { super.connectedCallback(); this.#watch() }
  override disconnectedCallback() { super.disconnectedCallback(); this.#off?.(); this.#off = undefined }
  protected override willUpdate(changed: PropertyValues) { if (changed.has('component')) this.#watch() }
}

/** Append a `tag` view of `component` to `el` (for hosts; inside templates just bind `.component`). */
export const mount = (component: Component, tag: string, el: Element) =>
  el.appendChild(Object.assign(document.createElement(tag), { component }))
