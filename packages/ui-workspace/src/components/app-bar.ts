// <nano-app-bar name="app">: shows one element in the app bar: the shown page's controls, or the focused panel's.
// boot-app-bar.ts says which. BACKLOG(5): it was a PlacedElement over the app gateway (AppGateway.appBar), which
// resolved an instance to its element; nano-core 0.4 has no gateway, so the host hands it the element.
import { showStatus } from '../lib/status.ts'

export class AppBarEl extends HTMLElement {
  #el: Element | null = null
  connectedCallback() { this.style.display = 'contents' }   // light DOM: the shown element takes the app bar's styles and colour

  /** Shows `el` (or nothing); `what` names it, for the status line when it has no element. */
  show(el: Element | null, what?: string) {
    if (!el && what) showStatus(document, `${what} has no element to show in the app bar`)
    if (el === this.#el) return
    this.#el = el
    this.replaceChildren(...(el ? [el] : []))
  }
}

/** Registers `<nano-app-bar>`. */
export function defineAppBar() {
  if (!customElements.get('nano-app-bar')) customElements.define('nano-app-bar', AppBarEl)
}
