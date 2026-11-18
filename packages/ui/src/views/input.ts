/**
 * `nano-input`: a field of its pod's `kind` (text, textarea, number, boolean), a kind picker and Send. Every edit calls
 * `change` with the value (a number for number, a boolean for boolean); Enter submits (Ctrl/Cmd+Enter in a text area),
 * ticking a checkbox submits, and so does Send. The picker applies the pod's config with the new kind.
 */
import { html } from 'lit'
import type { PodDeployment } from '@pritzlaff/nano-core'
import { KINDS, type InputKind } from '../pods/input.ts'
import { ViewElement, type ViewTarget } from './view.ts'

export class NanoInput extends ViewElement {
  private value: unknown = ''

  private kind(tg: ViewTarget): InputKind { return (tg.app.deployment().pods[tg.pod]?.config as { kind?: InputKind } | undefined)?.kind ?? 'text' }
  private async edit(tg: ViewTarget, v: unknown) { this.value = v; await this.pod(tg).change(v) }
  private async send(tg: ViewTarget) { await this.pod(tg).submit(this.value) }
  private async setKind(tg: ViewTarget, kind: InputKind) {
    const d = tg.app.deployment(), p = d.pods[tg.pod]
    if (!p) return
    const pods: PodDeployment = { ...d.pods, [tg.pod]: { ...p, config: { ...(p.config as object | undefined), kind } } }
    this.value = kind === 'boolean' ? false : kind === 'number' ? 0 : ''
    await tg.app.apply({ ...d, pods })
  }

  protected face(tg: ViewTarget) {
    const kind = this.kind(tg), box = (e: Event) => e.target as HTMLInputElement
    const parse = (el: HTMLInputElement) => (kind === 'number' ? Number(el.value) : kind === 'boolean' ? el.checked : el.value)
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || (kind === 'textarea' && !e.ctrlKey && !e.metaKey)) return
      e.preventDefault(); this.value = parse(box(e)); void this.send(tg)
    }
    const field = kind === 'textarea' ? html`<textarea rows="3" aria-label=${tg.pod} .value=${String(this.value ?? '')} @input=${(e: Event) => this.edit(tg, parse(box(e)))} @keydown=${key}></textarea>`
      : kind === 'boolean' ? html`<input type="checkbox" aria-label=${tg.pod} .checked=${!!this.value} @change=${async (e: Event) => { await this.edit(tg, parse(box(e))); await this.send(tg) }}>`
      : html`<input type=${kind} aria-label=${tg.pod} .value=${String(this.value ?? '')} @input=${(e: Event) => this.edit(tg, parse(box(e)))} @keydown=${key}>`
    return html`<div class="row">
      <select aria-label="Kind" @change=${(e: Event) => this.setKind(tg, (e.target as HTMLSelectElement).value as InputKind)}>${KINDS.map(k => html`<option ?selected=${k === kind}>${k}</option>`)}</select>
      ${field}<button class="primary" @click=${() => this.send(tg)}>Send</button></div>`
  }
}
