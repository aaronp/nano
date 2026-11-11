// <c-sandboxed name>: shows the sandboxed instance at `name` by placing its iframe (which lives in the layer) over itself.
import { LitElement, css, html } from 'lit'
import { hasRuntime, type Owner, type Registry, type Result } from '@pritzlaff/nano-core'
import { providedRegistry } from '@pritzlaff/nano-elements'
import type { Frame } from './stand-in'

/** Which element shows each frame: an iframe is one view. */
const viewers = new WeakMap<Frame, SandboxedElement>()

export class SandboxedElement extends LitElement {
  static properties = { name: {}, kind: {}, mode: {}, note: { state: true } }
  static styles = css`:host { display: block; min-height: 4rem; } p { margin: 0; padding: .5rem; font: inherit; opacity: .7; }`
  declare name?: string
  declare note?: string
  declare kind?: string
  declare mode?: string
  /** The system the instance lives in; unset, the page's provided registry (a dock hands its own). */
  declare registry?: Registry
  #frame?: Frame
  #ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => this.#place())
  #place = () => {
    const el = this.#frame?.element
    if (!el || viewers.get(this.#frame!) !== this) return
    const r = this.getBoundingClientRect()
    Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, display: 'block' })
  }
  /** The frame of the instance at `name` (a guarded one is a wrapper: its stand-in, same id, is inside). */
  #find(): Frame | undefined {
    let v: unknown = this.registry?.get(this.name!)?.value
    while (hasRuntime(v)) v = v.runtime.registry.get(this.name!)?.value
    return (v as Frame | undefined)?.port ? (v as Frame) : undefined
  }
  // a placeholder can move without resizing (a dock tab or drag), which no observer reports: re-measure every frame while shown
  // ponytail: one getBoundingClientRect per frame per shown sandbox; use the dock's layout event if it grows one
  #last = ''
  #raf = 0
  #watch = () => {
    const f = this.#frame
    if (!f) return
    if (this.#find() !== f) {   // the instance was removed: its frame is disposed
      if (viewers.get(f) === this) viewers.delete(f)
      if (f.element) f.element.style.display = 'none'
      this.#frame = undefined; this.note = 'removed'; this.#ro?.disconnect()
      return
    }
    const r = this.getBoundingClientRect(), k = `${r.left},${r.top},${r.width},${r.height}`
    if (k !== this.#last) { this.#last = k; this.#place() }
    this.#raf = requestAnimationFrame(this.#watch)
  }

  connectedCallback() {
    super.connectedCallback()
    const reg = this.registry ??= providedRegistry(this.ownerDocument)
    this.name ??= this.getAttribute('name') ?? `c-sandboxed-${n++}`
    this.kind ??= this.getAttribute('kind') ?? undefined
    this.mode ??= this.getAttribute('mode') ?? 'isolated-sandbox'
    const owner = { kind: 'widget', name: 'c-sandboxed' }
    const deployer = deployers.get(this.ownerDocument)
    if (reg && !reg.get(this.name) && this.kind && deployer) {
      const r = deployer(reg, this.name, this.kind, this.mode, owner)
      if ('error' in r) { this.note = r.error; return }
    }
    this.#frame = this.#find()
    const f = this.#frame
    if (!f) { this.note = `no sandboxed instance "${this.name}"`; return }
    const holder = viewers.get(f)
    if (holder && holder !== this && holder.isConnected) { this.note = 'shown elsewhere'; return }
    viewers.set(f, this); this.note = undefined
    f.ready.catch(e => { if (viewers.get(f) === this) this.note = e instanceof Error ? e.message : String(e) })
    this.#ro?.observe(this)
    addEventListener('scroll', this.#place, true); addEventListener('resize', this.#place)
    this.#place()
    this.#raf = requestAnimationFrame(this.#watch)
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    cancelAnimationFrame(this.#raf)
    this.#ro?.disconnect()
    removeEventListener('scroll', this.#place, true); removeEventListener('resize', this.#place)
    const f = this.#frame
    if (f && viewers.get(f) === this) { viewers.delete(f); if (f.element) f.element.style.display = 'none' }
  }

  protected render() { return html`${this.note ? html`<p>${this.note}</p>` : ''}` }
}

const deployers = new WeakMap<Document, DeployFn>()
let n = 0
/** Provides how `doc`'s <c-sandboxed> elements create the instance they show (when none is at their `name`). */
export const provideDeploy = (doc: Document, fn: DeployFn) => { deployers.set(doc, fn) }
export type DeployFn = (registry: Registry, id: string, kind: string, mode: string, owner: Owner) => Result<void>

export const defineSandboxed = () => { if (!customElements.get('c-sandboxed')) customElements.define('c-sandboxed', SandboxedElement) }
