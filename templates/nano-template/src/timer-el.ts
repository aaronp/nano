// <nano-timer name="…">: places a Timer by name (or attaches to one), and shows and drives it.
import { css, html } from 'lit'
import { PlacedElement } from '@pritzlaff/nano-elements'
import { Timer } from './timer'

/** The count, Start/Stop, Reset and the interval. Plain styles: a host's theme can restyle it later. */
export class TimerEl extends PlacedElement {
  static component = Timer
  static styles = css`
    :host { display: block; font: 14px system-ui, sans-serif }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
    .count { font: 600 32px ui-monospace, monospace; min-width: 3ch }
    button, input { font: inherit; padding: 4px 10px }
    input { width: 6em }
    .problem { color: #c33; margin-top: 4px }`
  render() {
    const running = this.read<boolean>(Timer.ops.running) ?? false
    return html`<div class="row">
      <span class="count">${this.read<number>(Timer.ops.count) ?? 0}</span>
      <button @click=${() => this.act(running ? Timer.ops.stop : Timer.ops.start)}>${running ? 'Stop' : 'Start'}</button>
      <button @click=${() => this.act(Timer.ops.reset)}>Reset</button>
      <label>interval ms <input type="number" min="10" max="2147483647" .value=${String(this.read<number>(Timer.ops.interval) ?? 1000)}
        @change=${(e: Event) => this.act(Timer.ops.setInterval, Number((e.target as HTMLInputElement).value))}></label>
    </div>${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}`
  }
}
