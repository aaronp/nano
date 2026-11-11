// <nano-app-bar name="app">: shows the element of whatever instance the app gateway's appBar names (a second view of
// that instance, attached by name in its system's registry). `resolve` says which element and registry; the host sets it.
import { nothing } from 'lit'
import type { Registry } from '@pritzlaff/nano-core'
import { PlacedElement } from '@pritzlaff/nano-elements'
import { AppGateway, type Target } from '@composable/shell'
import { showStatus } from '../lib/status.ts'

/** The element tag and registry for an instance, or undefined if it has no element. */
export type Resolve = (t: { system: string; instance: string }) => { tag: string; registry: Registry } | undefined

export class AppBarEl extends PlacedElement {
  static component = AppGateway
  static properties = { ...PlacedElement.properties, resolve: { attribute: false } }
  declare resolve?: Resolve
  #key = 'null'
  #el?: HTMLElement

  createRenderRoot() { return this }   // light DOM: the shown element takes the app bar's styles and colour
  connectedCallback() { this.style.display = 'contents'; super.connectedCallback() }

  willUpdate(changed: Map<string, unknown>) {
    super.willUpdate(changed)
    const t = this.read<Target>(AppGateway.ops.appBar) ?? null, key = JSON.stringify(t)
    if (key === this.#key && !changed.has('resolve')) return   // same target: the shown element stays
    this.#key = key
    const r = t && this.resolve?.(t)
    if (t && !r) showStatus(document, `${t.instance} has no element to show in the app bar`)
    this.#el = undefined
    if (!t || !r) return
    const el = document.createElement(r.tag) as HTMLElement & { registry?: Registry }
    el.registry = r.registry; el.setAttribute('name', t.instance)   // before it connects: it attaches, never makes its own
    this.#el = el
  }

  render() { return this.#el ?? nothing }
}

/** Registers `<nano-app-bar>`. */
export function defineAppBar() {
  if (!customElements.get('nano-app-bar')) customElements.define('nano-app-bar', AppBarEl as unknown as CustomElementConstructor)
}
