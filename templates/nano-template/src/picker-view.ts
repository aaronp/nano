import { html } from 'lit'
import type { NanoSelect } from '@pritzlaff/nano-elements'
import type { ViewTarget } from '@pritzlaff/nano-ui'
import { OPTIONS } from './picker.ts'
import { View } from './view.ts'

/** `<nano-picker>`: the kit's `<nano-select>` over the configured options (`config.options`, else red/green/blue). */
export class PickerView extends View {
  protected face(t: ViewTarget) {
    const options = (t.app.deployment().pods[t.pod]?.config as { options?: string[] } | undefined)?.options ?? OPTIONS
    return html`<nano-select label=${t.pod} .options=${options} @change=${(e: Event) => this.pod(t).pick((e.target as NanoSelect).value)}></nano-select>`
  }
}
