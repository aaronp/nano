// <nano-timer name="…">: places a Timer by name (or attaches to one), and shows and drives it.
import { css, html } from 'lit'
import { PlacedElement } from '@pritzlaff/nano-elements'
import { Timer } from './timer'

/** The count, Start/Stop, Reset and the interval. Plain styles: a host's theme can restyle it later. */
export class TimerEl extends PlacedElement {
  static component = Timer
  // the host's look, through the --nano-* tokens (see @pritzlaff/nano-elements' README); the fallbacks are plain
  static styles = css`
    :host { display: block; font: 14px var(--nano-font, system-ui, sans-serif); color: var(--nano-fg, inherit) }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap }
    .count { font: 600 32px var(--nano-font-mono, ui-monospace, monospace); min-width: 3ch; color: var(--nano-accent, inherit) }
    button, input { font: inherit; padding: 4px 10px; color: var(--nano-fg, inherit); background: var(--nano-surface, transparent);
      border: 1px solid var(--nano-border-strong, #8888); border-radius: var(--nano-radius-s, 6px) }
    input { width: 6em }
    .problem { color: var(--nano-bad, #c33); margin-top: 4px }`
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
