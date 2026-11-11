// <c-sandboxed name>: shows the sandboxed instance at `name` by placing its iframe (which lives in the layer) over itself.
import { LitElement, css, html } from 'lit'
import { providedRegistry } from '@pritzlaff/nano-elements'
import type { Frame } from './stand-in'

/** Which element shows each frame: an iframe is one view. */
const viewers = new WeakMap<Frame, SandboxedElement>()

export class SandboxedElement extends LitElement {
  static properties = { name: {}, note: { state: true } }
  static styles = css`:host { display: block; min-height: 4rem; } p { margin: 0; padding: .5rem; font: inherit; opacity: .7; }`
  declare name?: string
  declare note?: string
  #frame?: Frame
  #ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => this.#place())
  #place = () => {
    const el = this.#frame?.element
    if (!el || viewers.get(this.#frame!) !== this) return
    const r = this.getBoundingClientRect()
    el.style.cssText += `;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;display:block`
  }

  connectedCallback() {
    super.connectedCallback()
    const v = (providedRegistry(this.ownerDocument)?.get(this.name ?? '')?.value ?? undefined) as Frame | undefined
    this.#frame = v?.port ? v : undefined
    const f = this.#frame
    if (!f) { this.note = `no sandboxed instance "${this.name}"`; return }
    const holder = viewers.get(f)
    if (holder && holder !== this && holder.isConnected) { this.note = 'shown elsewhere'; return }
    viewers.set(f, this); this.note = undefined
    f.ready.catch(e => { if (viewers.get(f) === this) this.note = e instanceof Error ? e.message : String(e) })
    this.#ro?.observe(this)
    addEventListener('scroll', this.#place, true); addEventListener('resize', this.#place)
    this.#place()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    this.#ro?.disconnect()
    removeEventListener('scroll', this.#place, true); removeEventListener('resize', this.#place)
    const f = this.#frame
    if (f && viewers.get(f) === this) { viewers.delete(f); if (f.element) f.element.style.display = 'none' }
  }

  protected render() { return html`${this.note ? html`<p>${this.note}</p>` : ''}` }
}

export const defineSandboxed = () => { if (!customElements.get('c-sandboxed')) customElements.define('c-sandboxed', SandboxedElement) }
