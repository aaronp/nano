// <nano-file-menu>: a "File" button opening a list of commands; each click dispatches `file:<command>` and closes.
// Examples › is a sub-menu (opens on hover or click). An example dispatches `file:example` with `{ name }`: the example shipped with the workspace at examples/<name>/nano.json.
import { css, html, LitElement, svg } from 'lit'
import { base } from '@pritzlaff/nano-elements'

export const COMMANDS = [['new', 'New'], ['open', 'Open…'], ['import', 'Import…'], ['save', 'Save'], ['reconcile', 'Reconcile and save'], ['save-as', 'Save As…'], ['download', 'Download']] as const
/** The examples shipped with the workspace, one click to import: [name, label]. */
export const EXAMPLES = [['typing', 'Typing: input → debounce → map → log'], ['chat', 'Chat: a room and its backend'], ['todo', 'Todo'], ['raft', 'Raft: a cluster that elects a leader']] as const

// 24×24 stroke paths, the nav's icon style
const ICONS: Record<string, ReturnType<typeof svg>> = {
  new: svg`<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>`,
  open: svg`<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`,
  import: svg`<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>`,
  save: svg`<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>`,
  'save-as': svg`<path d="M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v4"/><path d="M7 3v5h8M18 15l3 3-5 5h-3v-3z"/>`,
  reconcile: svg`<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 13l3 3 5-6"/>`,
  download: svg`<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>`,
}

export class FileMenuEl extends LitElement {
  static properties = { open: { state: true }, examples: { state: true }, dirty: { type: Boolean } }
  static styles = [base, css`
    :host { display: inline-block; position: relative }
    button { font: inherit; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 4px 10px; cursor: pointer }
    button:hover:not(:disabled) { background: color-mix(in srgb, currentColor 12%, transparent) }
    button:focus-visible { outline: 2px solid var(--nano-accent, #8FB3FF); outline-offset: 2px }
    button:disabled { opacity: 0.5; cursor: default }
    .panel { position: absolute; left: 0; top: calc(100% + 4px); z-index: 10; min-width: 10rem; display: flex; flex-direction: column; padding: 4px;
      background: var(--nano-surface, #131820); border: 1px solid var(--nano-border, #2A303C); border-radius: 8px }
    .panel[hidden] { display: none }
    .panel button { display: flex; align-items: center; justify-content: flex-start; text-align: left; white-space: nowrap; gap: 8px; border: 0; color: var(--nano-fg, #E6EAF0) }
    .sub { position: relative; display: flex; flex-direction: column }
    .sub > button { border-top: 1px solid var(--nano-border, #2A303C); border-radius: 0 0 6px 6px; margin-top: 4px }
    .sub > button span { margin-left: auto; padding-left: 16px }
    .sub .panel { left: 100%; top: 0 }
    .panel button:hover:not(:disabled) { background: var(--nano-surface-2, #222933) }
    .panel svg { flex: none; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round }`]
  declare open: boolean
  declare examples: boolean
  declare dirty: boolean
  constructor() { super(); this.open = false; this.examples = false; this.dirty = false }
  #outside = (e: Event) => { if (this.open && !e.composedPath().includes(this)) this.open = this.examples = false }

  firstUpdated() {
    this.addEventListener('keydown', e => { if (e.key === 'Escape' && this.examples) this.#back(); else if (e.key === 'Escape' && this.open) this.#close(true) })
    this.addEventListener('focusout', e => { if (this.open && e.relatedTarget instanceof Node && !this.contains(e.relatedTarget)) this.open = this.examples = false })
  }
  connectedCallback() { super.connectedCallback(); document.addEventListener('click', this.#outside) }
  disconnectedCallback() { super.disconnectedCallback(); document.removeEventListener('click', this.#outside) }

  #back() { this.examples = false; void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('[aria-controls="examples"]')?.focus()) }
  #close(refocus: boolean) { this.open = this.examples = false; if (refocus) void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('button')?.focus()) }
  #run(cmd: string, detail?: unknown) { this.#close(true); this.dispatchEvent(new CustomEvent(`file:${cmd}`, { bubbles: true, composed: true, detail })) }

  render() {
    return html`<button aria-controls="panel" aria-expanded=${this.open ? 'true' : 'false'} @click=${() => { this.open = !this.open; this.examples = false }}>File</button>
      <div id="panel" class="panel" role="group" aria-label="File" ?hidden=${!this.open}>${COMMANDS.map(([c, label]) =>
        html`<button data-cmd=${c} ?disabled=${c === 'save' && !this.dirty} @click=${() => this.#run(c)}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[c]}</svg>${label}</button>`)}
        <div class="sub" @mouseenter=${() => { this.examples = true }} @mouseleave=${() => { this.examples = false }}>
          <button aria-controls="examples" aria-expanded=${this.examples ? 'true' : 'false'} @click=${() => { this.examples = !this.examples }}>Examples<span aria-hidden="true">›</span></button>
          <div id="examples" class="panel" role="group" aria-label="Examples" ?hidden=${!this.examples}>${EXAMPLES.map(([name, label]) =>
            html`<button data-example=${name} @click=${() => this.#run('example', { name })}>${label}</button>`)}</div></div></div>`
  }
}
