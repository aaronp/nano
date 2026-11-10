// <nano-picker name="…" label="…">: places a Picker by name (or attaches to one), and shows it as the kit's
// <nano-select>, a filterable picker in the host's theme.
import { css, html } from 'lit'
import { PlacedElement, base, type NanoSelect } from '@pritzlaff/nano-elements'
import { Picker } from './picker'

export class PickerEl extends PlacedElement {
  static component = Picker
  static styles = [base, css`.kicker { margin-bottom: 4px } nano-select { width: 100% }`]
  render() {
    const label = this.getAttribute('label') ?? 'Pick'
    return html`<div class="kicker">${label}</div>
      <nano-select label=${label} .options=${this.read<string[]>(Picker.ops.options) ?? []} .value=${this.read<string>(Picker.ops.value) ?? ''}
        @change=${(e: Event) => this.act(Picker.ops.pick, (e.target as NanoSelect).value)}></nano-select>
      ${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}`
  }
}
