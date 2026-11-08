import { LitElement, type PropertyValues } from 'lit'
import type { Component, ComponentFactory, SystemRuntime } from '@composable/sdk'

type Observable = Component & { onChange?(fn: () => void): () => void }

const REQUEST = 'composable-system-request'
type Request = { system?: SystemRuntime }

/** Make `host` answer System requests from everything inside it (the request crosses shadow roots). Returns stop. */
export const provideSystem = (host: EventTarget, system: SystemRuntime) => {
  const answer = (e: Event) => {
    const d = (e as CustomEvent<Request>).detail
    if (d.system) return
    d.system = system
    e.stopPropagation()
  }
  host.addEventListener(REQUEST, answer)
  return () => host.removeEventListener(REQUEST, answer)
}

/** The System of the nearest enclosing provider, or undefined. */
export const requestSystem = (el: EventTarget): SystemRuntime | undefined => {
  const detail: Request = {}
  el.dispatchEvent(new CustomEvent(REQUEST, { detail, bubbles: true, composed: true }))
  return detail.system
}

let seq = 0

/**
 * Base for a view element. Set `.component` as a property (`<x-view .component=${c}>` in a template); the view
 * re-renders whenever the component reports a change, and any number of views can share one component.
 *
 * A view class with a `static factory` also places itself: connected without a component, it creates one and
 * registers it in the nearest provided System (under its `name` attribute, or a generated name); disconnected, it
 * unregisters and disposes it (it owns it). So the same element works in markup at build time or created at runtime.
 */
export class View<C extends Component = Component> extends LitElement {
  static properties = { component: { attribute: false } }
  static factory?: ComponentFactory<any>
  declare component: C
  #off?: () => void
  #placed?: { system: SystemRuntime; name: string; component?: Component }
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
      p.system.unregister(p.name)
      void p.component?.dispose?.()
    })
  }
  protected override shouldUpdate() { return !!this.component }
  protected override willUpdate(changed: PropertyValues) { if (changed.has('component')) this.#watch() }

  #place() {
    const factory = (this.constructor as typeof View).factory
    const system = factory && requestSystem(this)
    if (!factory || !system) return
    const p: { system: SystemRuntime; name: string; component?: Component } = { system, name: this.getAttribute('name') ?? `${this.localName}-${++seq}` }
    this.#placed = p
    Promise.resolve(factory.create()).then(
      c => {
        if (this.#placed !== p) return void c.dispose?.()       // removed while being created
        system.register(p.name, c)
        p.component = c
        this.component = c as C
      },
    ).catch(err => {
      if (this.#placed === p) this.#placed = undefined
      console.error(`<${this.localName}> could not join its System:`, err)
    })
  }
}

/** Append a view of `component` to `el`: `view` is a registered tag or the view's (registered) class. */
export const mount = (component: Component, view: string | CustomElementConstructor, el: Element) =>
  el.appendChild(Object.assign(typeof view === 'string' ? document.createElement(view) : new view(), { component }))

export { tokens, t, base, applyTheme, themes, type Theme, type Token } from './theme'
