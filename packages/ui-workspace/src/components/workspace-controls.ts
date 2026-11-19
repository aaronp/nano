// <nano-workspace-controls dock="<id>">: the controls of one workspace dock (layout, window style, connections, the Desk page,
// save, restore, reset), the element the app bar shows while that dock's page is shown. It drives the dock by id; nothing here is persisted.
// BACKLOG(5): it was also a nano-runes component (WorkspaceControls) in the host registry; now only the element.
import { LitElement, css, html, svg } from 'lit'
import { base } from '@pritzlaff/nano-elements'
import { WINDOW_STYLES, type WindowStyle } from '../lib/dock-layout.ts'
import { TEMPLATES, type TemplateId } from '../lib/layout-templates.ts'
import { requestBus, type Unsubscribe } from '../lib/bus.ts'


type Dock = HTMLElement & { template: TemplateId; setTemplate(id: TemplateId): boolean; windowStyle: WindowStyle; setWindowStyle(s: WindowStyle): void; connections(): void; saveAs(): void; save(): void; restore(): void; reset(): void }
type Command = 'connections' | 'desk' | 'saveAs' | 'save' | 'restore' | 'reset'

// 24×24 stroke paths, the File menu's icon style
const ICONS: Record<Command | 'more', ReturnType<typeof svg>> = {
  connections: svg`<circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.7 10.5l6.6-3M8.7 13.5l6.6 3"/>`,
  desk: svg`<path d="M6 3v18M12 3v18M18 3v18"/><rect x="4" y="6" width="4" height="3" rx="1"/><rect x="10" y="13" width="4" height="3" rx="1"/><rect x="16" y="9" width="4" height="3" rx="1"/>`,
  saveAs: svg`<path d="M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v4"/><path d="M7 3v5h8M18 15l3 3-5 5h-3v-3z"/>`,
  save: svg`<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>`,
  restore: svg`<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>`,
  reset: svg`<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>`,
  more: svg`<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>`,
}
const COMMANDS: [Command, string][] = [['connections', 'Connections'], ['desk', 'Desk'], ['saveAs', 'Save as workspace…'], ['save', 'Save layout'], ['restore', 'Restore'], ['reset', 'Reset']]
// one rect [x, y, w, h] per position on a 24x16 canvas, in the template's areas order (the free dock: a split, a stack)
const R: Record<TemplateId, number[][]> = {
  dock: [[1, 1, 10, 14], [13, 1, 10, 6], [13, 9, 10, 6]], one: [[1, 1, 22, 14]],
  'two-cols': [[1, 1, 10, 14], [13, 1, 10, 14]], 'two-rows': [[1, 1, 22, 6], [1, 9, 22, 6]],
  'main-two': [[1, 1, 14, 14], [17, 1, 6, 6], [17, 9, 6, 6]], 'three-cols': [[1, 1, 6, 14], [9, 1, 6, 14], [17, 1, 6, 14]],
  grid: [[1, 1, 10, 6], [13, 1, 10, 6], [1, 9, 10, 6], [13, 9, 10, 6]], 'main-drawer': [[1, 1, 14, 14], [17, 1, 6, 14]],
}
const NARROW = '(max-width: 840px)'

export class WorkspaceControlsEl extends LitElement {
  static properties = { dock: {}, open: { state: true }, narrow: { state: true } }
  static styles = [base, css`
    :host { display: inline-flex; align-items: center; gap: 4px; position: relative; color: inherit }
    button { font: inherit; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 4px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px }
    button:hover { background: color-mix(in srgb, currentColor 12%, transparent) }
    button:focus-visible { outline: 2px solid var(--nano-accent, #8FB3FF); outline-offset: 2px }
    svg { flex: none; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round }
    .layout { display: inline-flex; gap: 2px }
    .layout button[aria-checked="true"] { background: color-mix(in srgb, currentColor 22%, transparent) }
    .layout svg { width: 24px; height: 16px; fill: currentColor; stroke: none }
    .view { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 8px }
    .view button { padding: 2px 8px }
    .view button[aria-pressed="true"] { background: color-mix(in srgb, currentColor 22%, transparent) }
    .panel { position: absolute; right: 0; top: calc(100% + 4px); z-index: 10; min-width: 12rem; display: flex; flex-direction: column; padding: 4px;
      background: var(--nano-surface, #131820); border: 1px solid var(--nano-border, #2A303C); border-radius: 8px }
    .panel[hidden] { display: none }
    .panel button { color: var(--nano-fg, #E6EAF0) }
    .panel button:hover { background: var(--nano-surface-2, #222933) }`]
  declare dock: string
  declare open: boolean
  declare narrow: boolean
  #mq?: MediaQueryList
  #off?: Unsubscribe
  constructor() { super(); this.dock = ''; this.open = false; this.narrow = false }
  #dock() {
    const d = document.getElementById(this.dock) as Dock | null
    if (!d) throw new Error(`no dock ${this.dock}`)
    return d
  }
  #outside = (e: Event) => { if (this.open && !e.composedPath().includes(this)) this.open = false }
  #match = () => { this.narrow = !!this.#mq?.matches; if (!this.narrow) this.open = false }

  firstUpdated() {
    this.addEventListener('keydown', e => { if (e.key === 'Escape' && this.open) this.#close(true) })
    this.addEventListener('focusout', e => { if (this.open && e.relatedTarget instanceof Node && !this.contains(e.relatedTarget)) this.open = false })
  }
  connectedCallback() {
    super.connectedCallback()
    document.addEventListener('click', this.#outside)
    try { this.#off = requestBus(this).subscribe('dock:layout', () => this.requestUpdate()) } catch { /* outside a shell: re-renders on its own clicks */ }
    this.#mq = matchMedia(NARROW); this.#mq.addEventListener('change', this.#match); this.#match()
  }
  disconnectedCallback() {
    super.disconnectedCallback()
    document.removeEventListener('click', this.#outside)
    this.#off?.()
    this.#mq?.removeEventListener('change', this.#match)
  }

  #close(refocus: boolean) { this.open = false; if (refocus) void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.more')?.focus()) }
  // the Desk is a page of its own, not a dock command
  #run(c: Command) { if (c === 'desk') location.hash = '#/desk'; else this.#dock()[c]() }
  #cmd = (c: Command, label: string, text: boolean) => html`<button aria-label=${label} title=${label} @click=${() => { this.#close(false); this.#run(c) }}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[c]}</svg>${text ? label : ''}</button>`

  #layouts(d: Dock | null) {
    return html`<span class="layout" role="radiogroup" aria-label="Layout">${TEMPLATES.map(t => html`<button role="radio" aria-label=${t.title} aria-checked=${(d?.template ?? 'dock') === t.id ? 'true' : 'false'} title=${t.title}
        @click=${() => { this.#dock().setTemplate(t.id); this.requestUpdate() }}><svg viewBox="0 0 24 16" aria-hidden="true">${R[t.id].map(([x, y, w, h]) => svg`<rect x=${x} y=${y} width=${w} height=${h} rx="1"/>`)}</svg></button>`)}</span>`
  }

  render() {
    const d = document.getElementById(this.dock) as Dock | null
    const style: WindowStyle = d?.windowStyle ?? 'tabs'
    const free = (d?.template ?? 'dock') === 'dock'
    const view = html`<span class="view" role="group" aria-label="View">${WINDOW_STYLES.map(w =>
        html`<button aria-pressed=${style === w.id ? 'true' : 'false'} @click=${() => { this.#dock().setWindowStyle(w.id); this.requestUpdate() }}>${w.title}</button>`)}</span>`
    return html`${this.narrow ? '' : this.#layouts(d)}${free ? view : ''}
      ${this.narrow
        ? html`<button class="more" aria-label="More workspace actions" title="More workspace actions" aria-controls="panel" aria-expanded=${this.open ? 'true' : 'false'}
              @click=${() => { this.open = !this.open }}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.more}</svg></button>
            <div id="panel" class="panel" role="group" aria-label="Workspace actions" ?hidden=${!this.open}>${this.#layouts(d)}${COMMANDS.map(([c, l]) => this.#cmd(c, l, true))}</div>`
        : COMMANDS.map(([c, l]) => this.#cmd(c, l, false))}`
  }
}

/** Registers `<nano-workspace-controls>`. */
export function defineWorkspaceControls() {
  if (!customElements.get('nano-workspace-controls')) customElements.define('nano-workspace-controls', WorkspaceControlsEl as unknown as CustomElementConstructor)
}
