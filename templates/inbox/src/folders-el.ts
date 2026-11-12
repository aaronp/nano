// <inbox-folders name="…">: places a Folders by name (or attaches to one) and shows it as a column of buttons.
import { css, html } from 'lit'
import { PlacedElement, base } from '@pritzlaff/nano-elements'
import { Folders } from './folders'

export class FoldersEl extends PlacedElement {
  static component = Folders
  static styles = [base, css`
    nav { display: grid; gap: 2px }
    button { font: inherit; text-align: left; color: inherit; background: none; border: 0; border-radius: var(--nano-radius-s, 6px); padding: 6px 10px; cursor: pointer }
    button:hover { background: var(--nano-surface-2, #212632) }
    button[aria-current='true'] { background: var(--nano-accent-soft, #1E2635); color: var(--nano-accent, #6FA8FF); font-weight: 600 }
    button:focus-visible { outline: 2px solid var(--nano-focus, #6FA8FF); outline-offset: 1px }`]
  render() {
    const current = this.read<string>(Folders.ops.current)
    return html`<nav aria-label="Folders">${(this.read<{ id: string; name: string }[]>(Folders.ops.folders) ?? []).map(f =>
      html`<button type="button" aria-current=${f.id === current ? 'true' : 'false'} @click=${() => this.act(Folders.ops.select, f.id)}>${f.name}</button>`)}</nav>
      ${this.problem ? html`<div class="problem">${this.problem}</div>` : ''}`
  }
}
