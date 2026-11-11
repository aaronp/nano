// <nano-file-menu>: a "File" button opening a list of commands; each click dispatches `file:<command>` and closes.
import { css, html, LitElement } from 'lit'
import { base } from '@pritzlaff/nano-elements'

export const COMMANDS = [['new', 'New'], ['open', 'Open…'], ['import', 'Import…'], ['save', 'Save'], ['save-as', 'Save As…'], ['download', 'Download']] as const

export class FileMenuEl extends LitElement {
  static properties = { open: { state: true }, dirty: { type: Boolean } }
  static styles = [base, css`
    :host { display: inline-block; position: relative }
    button { font: inherit; color: var(--nano-fg, #E6EAF0); background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 4px 10px; cursor: pointer }
    button:hover:not(:disabled) { background: var(--nano-surface-2, #222933) }
    button:focus-visible { outline: 2px solid var(--nano-accent, #8FB3FF); outline-offset: 2px }
    button:disabled { opacity: 0.5; cursor: default }
    .panel { position: absolute; left: 0; top: calc(100% + 4px); z-index: 10; min-width: 10rem; display: flex; flex-direction: column; padding: 4px;
      background: var(--nano-surface, #131820); border: 1px solid var(--nano-border, #2A303C); border-radius: 8px }
    .panel[hidden] { display: none }
    .panel button { text-align: left }`]
  declare open: boolean
  declare dirty: boolean
  constructor() { super(); this.open = false; this.dirty = false }
  #outside = (e: Event) => { if (this.open && !e.composedPath().includes(this)) this.open = false }

  firstUpdated() {
    this.addEventListener('keydown', e => { if (e.key === 'Escape' && this.open) this.#close(true) })
    this.addEventListener('focusout', e => { if (this.open && e.relatedTarget instanceof Node && !this.contains(e.relatedTarget)) this.open = false })
  }
  connectedCallback() { super.connectedCallback(); document.addEventListener('click', this.#outside) }
  disconnectedCallback() { super.disconnectedCallback(); document.removeEventListener('click', this.#outside) }

  #close(refocus: boolean) { this.open = false; if (refocus) void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('button')?.focus()) }
  #run(cmd: string) { this.#close(true); this.dispatchEvent(new CustomEvent(`file:${cmd}`, { bubbles: true, composed: true })) }

  render() {
    return html`<button aria-controls="panel" aria-expanded=${this.open ? 'true' : 'false'} @click=${() => { this.open = !this.open }}>File</button>
      <div id="panel" class="panel" role="group" aria-label="File" ?hidden=${!this.open}>${COMMANDS.map(([c, label]) =>
        html`<button data-cmd=${c} ?disabled=${c === 'save' && !this.dirty} @click=${() => this.#run(c)}>${label}</button>`)}</div>`
  }
}
