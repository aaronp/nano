// The base of the template's views: a custom element over one pod, with `target`; it reaches the pod through
// `target.app` (`call`, `listen`, or a runtime's typed client). `hear` sees every application event while connected.
import { LitElement, html } from 'lit'
import type { AppEvent } from '@pritzlaff/nano-core'
import { base, kit } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'

export class View extends LitElement {
  static properties = { target: { attribute: false } }
  static styles = [base, kit]
  declare target?: ViewTarget
  private off?: () => void
  private watching?: ViewTarget

  connectedCallback() { super.connectedCallback(); this.watch() }
  disconnectedCallback() { super.disconnectedCallback(); this.off?.(); this.off = this.watching = undefined }
  willUpdate(changed: Map<string, unknown>) { if (changed.has('target')) this.watch() }

  private watch() {
    const t = this.target
    if (!t || !this.isConnected || this.watching === t) return
    this.off?.()
    this.watching = t
    this.off = t.app.listen(e => this.hear(e, t))
    this.started(t)
  }
  /** The pod's client. */
  protected pod(t: ViewTarget) { return t.app.call(t.runtime, t.pod) }
  protected started(_t: ViewTarget) {}
  protected hear(_e: AppEvent, _t: ViewTarget) {}
  protected face(_t: ViewTarget): unknown { return html`` }
  render() { return this.target ? this.face(this.target) : html`` }
}
