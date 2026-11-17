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

type Pt = { x: number; y: number }
/** The CSS matrix3d taking a w×h box at the origin onto the quad p0 (top left), p1, p2, p3 (clockwise): a homography,
 * exact for any perspective tilt. Undefined when the quad is mirrored (the pane shows its back) or degenerate. */
export function quadMatrix(w: number, h: number, [p0, p1, p2, p3]: Pt[]): string | undefined {
  if ((p1!.x - p0!.x) * (p3!.y - p0!.y) - (p1!.y - p0!.y) * (p3!.x - p0!.x) <= 0) return undefined
  const dx1 = p1!.x - p2!.x, dx2 = p3!.x - p2!.x, dx3 = p0!.x - p1!.x + p2!.x - p3!.x
  const dy1 = p1!.y - p2!.y, dy2 = p3!.y - p2!.y, dy3 = p0!.y - p1!.y + p2!.y - p3!.y
  const den = dx1 * dy2 - dx2 * dy1
  if (!den) return undefined
  const g = (dx3 * dy2 - dx2 * dy3) / den, k = (dx1 * dy3 - dx3 * dy1) / den
  const a = p1!.x - p0!.x + g * p1!.x, b = p3!.x - p0!.x + k * p3!.x, d = p1!.y - p0!.y + g * p1!.y, e = p3!.y - p0!.y + k * p3!.y
  return `matrix3d(${[a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, p0!.x, p0!.y, 0, 1].join(',')})`
}

class SandboxedView extends LitElement {
  static properties = { target: { attribute: false }, note: { state: true } }
  static styles = css`:host { display: block; position: relative; height: 100%; min-height: 4rem }
    i { position: absolute; width: 0; height: 0 } i:nth-of-type(2), i:nth-of-type(3) { left: 100% } i:nth-of-type(1), i:nth-of-type(2) { top: 0 } i:nth-of-type(3), i:nth-of-type(4) { top: 100% }
    i:nth-of-type(1), i:nth-of-type(4) { left: 0 } p { margin: 0; padding: .5rem; opacity: .7 }`
  declare target?: ViewTarget
  declare note?: string
  #frame?: Frame
  #last = ''
  #raf = 0

  // A placeholder can move without resizing (a dock tab or drag), or tilt in 3D (Connections), which no observer reports:
  // its corners (four 0×0 markers) are measured every animation frame and the iframe given the same projection.
  // ponytail: four getBoundingClientRects per frame per shown sandbox; use the dock's layout event if it grows one
  #watch = () => {
    const t = this.target, f = t && framesOf.get(t.app)?.get(t.pod)
    if (f !== this.#frame) { hide(this.#frame, this); this.#frame = f; this.#last = '' }
    const holder = f && viewers.get(f)
    if (f && !holder?.isConnected) viewers.set(f, this)
    const el = f && viewers.get(f) === this ? f.element : undefined
    this.note = !f ? 'not running' : el || !f.element ? undefined : 'shown elsewhere'
    if (el) {
      const q = [...this.renderRoot.querySelectorAll('i')].map(c => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top } })
      const w = this.offsetWidth, h = this.offsetHeight, k = `${w},${h},${q.map(p => `${p.x},${p.y}`)}`
      if (q.length === 4 && k !== this.#last) {
        this.#last = k
        const m = quadMatrix(w, h, [q[0]!, q[1]!, q[2]!, q[3]!])
        Object.assign(el.style, { left: '0', top: '0', width: `${w}px`, height: `${h}px`, transformOrigin: '0 0', transform: m ?? '', display: m ? 'block' : 'none' })
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

  render() { return html`<i></i><i></i><i></i><i></i>${this.note ? html`<p>${this.note}</p>` : ''}` }
}

if (!customElements.get('nano-sandboxed')) customElements.define('nano-sandboxed', SandboxedView)
