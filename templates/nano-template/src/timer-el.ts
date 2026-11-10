// <nano-timer name="…">: places a Timer by name (or attaches to one), and shows and drives it.
import { css, html } from 'lit'
import { PlacedElement, base, kit } from '@pritzlaff/nano-elements'
import { Timer } from './timer'

/** The count, Start/Stop, Reset and the interval, from the component library (so it takes the host's theme). */
export class TimerEl extends PlacedElement {
  static component = Timer
  static styles = [base, kit, css`
    .count { font: 600 32px var(--nano-font-mono, ui-monospace, monospace); min-width: 3ch; color: var(--nano-accent, inherit) }
    .input-group { width: 9em }`]
  render() {
    const running = this.read<boolean>(Timer.ops.running) ?? false
    return html`<div class="row">
      <span class="count">${this.read<number>(Timer.ops.count) ?? 0}</span>
      <span class="badge ${running ? 'good' : ''}">${running ? 'running' : 'stopped'}</span>
    </div><div class="row" style="margin-top:8px">
      <button class="btn ${running ? '' : 'primary'}" @click=${() => this.act(running ? Timer.ops.stop : Timer.ops.start)}>${running ? 'Stop' : 'Start'}</button>
      <button class="btn" @click=${() => this.act(Timer.ops.reset)}>Reset</button>
      <label class="input-group" title="Interval"><input type="number" aria-label="Interval (ms)" min="10" max="2147483647" .value=${String(this.read<number>(Timer.ops.interval) ?? 1000)}
        @change=${(e: Event) => this.act(Timer.ops.setInterval, Number((e.target as HTMLInputElement).value))}><span class="addon">ms</span></label>
    </div>${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}`
  }
}
