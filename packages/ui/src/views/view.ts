/**
 * The view contract: a view is a custom element over one pod, with a `target: ViewTarget` property. It reaches its pod
 * only through `target.app.call(target.runtime, target.pod)` and `target.app.listen`. `viewFor` picks the tag.
 *
 *   viewFor('up', { ...app.deployment(), views }, defaults)   // the selector, else the default, else 'nano-pod-view'
 */
import { LitElement, html } from 'lit'
import type { AppDeployment, AppEvent, Application, Registry } from '@pritzlaff/nano-core'
import { base } from '@pritzlaff/nano-elements'

export type ViewTarget = { app: Application; registry: Registry; runtime: string; pod: string }
/** An implementation coordinate → a custom-element tag. */
export type ViewMap = Record<string, string>

const defined = (tag: string | undefined) => (tag && customElements.get(tag) ? tag : undefined)

export function viewFor(pod: string, deployment: AppDeployment, defaults: ViewMap): string {
  const impl = deployment.pods[pod]?.implementation
  return defined(deployment.views?.[pod]) ?? defined(impl === undefined ? undefined : defaults[impl]) ?? 'nano-pod-view'
}

/**
 * What every view here shares: listening while connected and its pod is placed; "removed" once an `applied` removes it.
 * Not exported from the package: a view is any element with `target`, this is only how these ones are made.
 */
export class ViewElement extends LitElement {
  static properties = { target: { attribute: false }, removed: { state: true } }
  static styles = [base]
  declare target?: ViewTarget
  declare removed: boolean
  private off?: () => void
  private watching?: ViewTarget

  constructor() { super(); this.removed = false }
  connectedCallback() { super.connectedCallback(); this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.stop() }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) { this.removed = false; this.watch() } }

  private watch() {
    const t = this.target
    if (!t || !this.isConnected || this.removed || this.watching === t) return
    this.stop()
    this.watching = t
    this.off = t.app.listen(e => {
      if (e.type === 'applied' && e.removed.includes(t.pod)) { this.removed = true; this.stop(); return }
      if (e.type === 'applied') this.requestUpdate()   // config and placement are read from the deployment at render
      this.hear(e, t)
    })
    this.started(t)
  }
  private stop() { this.off?.(); this.off = undefined; this.watching = undefined }

  /** The pod's client. */
  protected pod(t: ViewTarget) { return t.app.call(t.runtime, t.pod) }
  /** Called once listening starts. */
  protected started(_t: ViewTarget) {}
  /** Every event while listening. */
  protected hear(_e: AppEvent, _t: ViewTarget) {}
  protected face(_t: ViewTarget): unknown { return html`` }

  render() {
    if (this.removed) return html`<div class="muted">removed</div>`
    return this.target ? this.face(this.target) : html``
  }
}

/** A result's value, shown. */
export const shown = (r: { ok: boolean; value?: unknown; fail?: { reason: string } } | undefined) =>
  r === undefined ? '—' : r.ok ? JSON.stringify(r.value) : `failed: ${r.fail?.reason}`
