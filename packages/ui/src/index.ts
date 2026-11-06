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

/** Append a view of `component` to `el`: `view` is a registered tag or the view's (registered) class. */
export const mount = (component: Component, view: string | CustomElementConstructor, el: Element) =>
  el.appendChild(Object.assign(typeof view === 'string' ? document.createElement(view) : new view(), { component }))

export { tokens, t, base, applyTheme, themes, type Theme, type Token } from './theme'
