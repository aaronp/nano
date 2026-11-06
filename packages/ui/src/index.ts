import { LitElement, type PropertyValues } from 'lit'
import type { Component, ComponentFactory, Scope } from '@composable/sdk'

type Observable = Component & { onChange?(fn: () => void): () => void }

const REQUEST = 'composable-scope-request'
type Request = { scope?: Scope }

/** Make `host` answer scope requests from everything inside it (the request crosses shadow roots). Returns stop. */
export const provideScope = (host: EventTarget, scope: Scope) => {
  const answer = (e: Event) => {
    const d = (e as CustomEvent<Request>).detail
    if (d.scope) return
    d.scope = scope
    e.stopPropagation()
  }
  host.addEventListener(REQUEST, answer)
  return () => host.removeEventListener(REQUEST, answer)
}

/** The scope of the nearest enclosing provider, or undefined. */
export const requestScope = (el: EventTarget): Scope | undefined => {
  const detail: Request = {}
  el.dispatchEvent(new CustomEvent(REQUEST, { detail, bubbles: true, composed: true }))
  return detail.scope
}

let seq = 0

/**
 * Base for a view element. Set `.component` as a property (`<x-view .component=${c}>` in a template); the view
 * re-renders whenever the component reports a change, and any number of views can share one component.
 *
 * A view class with a `static factory` also places itself: connected without a component, it adds one to the
 * nearest provided scope (under its `name` attribute, or a generated name) and removes it when disconnected. So
 * the same element works written in markup at build time or created at runtime.
 */
export class View<C extends Component = Component> extends LitElement {
  static properties = { component: { attribute: false } }
  static factory?: ComponentFactory<any>
  declare component: C
  #off?: () => void
  #placed?: { scope: Scope; name: string }
  #watch() { this.#off?.(); this.#off = (this.component as Observable | undefined)?.onChange?.(() => this.requestUpdate()) }

  override connectedCallback() {
    super.connectedCallback()
    this.#watch()
    if (!this.component && !this.#placed) this.#place()
  }
  override disconnectedCallback() {
    super.disconnectedCallback()
    this.#off?.(); this.#off = undefined
    // Deferred: an element that is only being moved (disconnected, then reconnected) keeps its component.
    if (this.#placed) setTimeout(() => {
      const p = this.#placed
      if (this.isConnected || !p) return
      this.#placed = undefined
      void p.scope.remove(p.name)
    })
  }
  protected override shouldUpdate() { return !!this.component }
  protected override willUpdate(changed: PropertyValues) { if (changed.has('component')) this.#watch() }

  #place() {
    const factory = (this.constructor as typeof View).factory
    const scope = factory && requestScope(this)
    if (!factory || !scope) return
    const p = { scope, name: this.getAttribute('name') ?? `${this.localName}-${++seq}` }
    this.#placed = p
    scope.add(p.name, factory).then(
      c => { if (this.#placed === p) this.component = c as C; else void scope.remove(p.name) },
      err => {
        if (this.#placed !== p) return // removed before it finished joining: expected
        this.#placed = undefined
        console.error(`<${this.localName}> could not join its scope:`, err)
      },
    )
  }
}

/** Append a view of `component` to `el`: `view` is a registered tag or the view's (registered) class. */
export const mount = (component: Component, view: string | CustomElementConstructor, el: Element) =>
  el.appendChild(Object.assign(typeof view === 'string' ? document.createElement(view) : new view(), { component }))

export { tokens, t, base, applyTheme, themes, type Theme, type Token } from './theme'
