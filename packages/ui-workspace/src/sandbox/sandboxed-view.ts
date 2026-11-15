/**
 * `<nano-sandboxed>`: a non-host pod's view. Its `target: ViewTarget` names the pod; it places the pod's frame (which
 * lives in the sandbox layer, rendering the pod's own view) over itself, and follows it when the pod is built again.
 *
 *   framesOf.set(app, frames)   // the host: pod name → its open frame
 *   el.target = { app, registry, runtime, pod }
 */
import { LitElement, css, html } from 'lit'
import type { Application } from '@pritzlaff/nano-core'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import type { Frame } from './stand-in.ts'

/** Each application's open frames by pod name, kept by the host. */
export const framesOf = new WeakMap<Application, Map<string, Frame>>()

/** Which element shows each frame: an iframe is one view. */
const viewers = new WeakMap<Frame, SandboxedView>()
const hide = (f: Frame | undefined, by: SandboxedView) => {
  if (f && viewers.get(f) === by) { viewers.delete(f); if (f.element) f.element.style.display = 'none' }
}

class SandboxedView extends LitElement {
  static properties = { target: { attribute: false }, note: { state: true } }
  static styles = css`:host { display: block; height: 100%; min-height: 4rem } p { margin: 0; padding: .5rem; opacity: .7 }`
  declare target?: ViewTarget
  declare note?: string
  #frame?: Frame
  #last = ''
  #raf = 0

  // A placeholder can move without resizing (a dock tab or drag), which no observer reports: measured every animation frame.
  // ponytail: one getBoundingClientRect per frame per shown sandbox; use the dock's layout event if it grows one
  #watch = () => {
    const t = this.target, f = t && framesOf.get(t.app)?.get(t.pod)
    if (f !== this.#frame) { hide(this.#frame, this); this.#frame = f; this.#last = '' }
    const holder = f && viewers.get(f)
    if (f && !holder?.isConnected) viewers.set(f, this)
    const el = f && viewers.get(f) === this ? f.element : undefined
    this.note = !f ? 'not running' : el || !f.element ? undefined : 'shown elsewhere'
    if (el) {
      const r = this.getBoundingClientRect(), k = `${r.left},${r.top},${r.width},${r.height}`
      if (k !== this.#last) {
        this.#last = k
        Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, display: 'block' })
      }
    }
    this.#raf = requestAnimationFrame(this.#watch)
  }

  connectedCallback() { super.connectedCallback(); this.#raf = requestAnimationFrame(this.#watch) }
  disconnectedCallback() {
    super.disconnectedCallback()
    cancelAnimationFrame(this.#raf)
    hide(this.#frame, this)
    this.#frame = undefined
  }

  render() { return html`${this.note ? html`<p>${this.note}</p>` : ''}` }
}

if (!customElements.get('nano-sandboxed')) customElements.define('nano-sandboxed', SandboxedView)
