import { html } from 'lit'
import { port, type AppEvent } from '@pritzlaff/nano-core'
import type { NanoSelect } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { Picker } from './interfaces.ts'
import { View } from './view.ts'

const SET = port(Picker, Picker.ops.setOptions)

/** `<nano-picker>`: the kit's filterable `<nano-select>` over the pod's `options`, read again after each `setOptions`. */
export class PickerView extends View {
  static properties = { ...View.properties, options: { state: true } }
  declare options: string[]
  private sets = new Set<string>()
  constructor() { super(); this.options = [] }

  protected started(t: ViewTarget) { void this.read(t) }
  private async read(t: ViewTarget) {
    const r = await this.pod(t).options(null)
    if (r.ok) this.options = r.value as string[]
  }
  protected hear(e: AppEvent, t: ViewTarget) {
    if (e.type === 'sent' && e.to === t.pod && e.port === SET) this.sets.add(e.id)
    else if (e.type === 'denied') this.sets.delete(e.id)
    else if (e.type === 'delivered' && this.sets.delete(e.id)) void this.read(t)
  }
  protected face(t: ViewTarget) {
    return html`<nano-select label=${t.pod} .options=${this.options} @change=${(e: Event) => this.pod(t).pick((e.target as NanoSelect).value)}></nano-select>`
  }
}
