// WorkspaceControls: the controls of one workspace dock (window style, connections, save, restore, reset), as a component
// and as the element the app bar shows while that dock is focused. It drives the dock by id; nothing here is persisted.
import { css, html, svg } from 'lit'
import { Type } from 'typebox'
import { base, PlacedElement } from '@pritzlaff/nano-elements'
import { component, state } from '@pritzlaff/nano-runes'
import { WINDOW_STYLES, type WindowStyle } from '../lib/dock-layout.ts'

/** The id of the controls instance for a dock. */
export const controlsId = (dockId: string) => `ws-controls-${dockId}`

type Dock = HTMLElement & { windowStyle: WindowStyle; setWindowStyle(s: WindowStyle): void; connections(): void; saveAs(): void; save(): void; restore(): void; reset(): void }
type Command = 'connections' | 'saveAs' | 'save' | 'restore' | 'reset'

// WINDOW_STYLES' ids, spelled out so the schema's type is exact (a mapped array widens it)
const Style_ = Type.Union([Type.Literal('tabs'), Type.Literal('focus')], { description: 'How the dock shows its windows: tabs, or clear (no tab for a lone panel)', examples: ['tabs'] })
const DockId_ = Type.String({ description: 'The id of the workspace dock these controls drive', examples: ['workspace'] })

export const WorkspaceControls = component('composable.ui-workspace/workspace-controls', () => {
  const s = state({ dock: '', style: 'tabs' as WindowStyle })
  const dock = () => {
    const d = document.getElementById(s.dock) as Dock | null
    if (!d) throw new Error(`no dock ${s.dock}`)
    return d
  }
  const run = (c: Command) => () => { dock()[c]() }
  return {
    get dock() { return s.dock }, get style() { return s.style },
    attach: (id: string) => { s.dock = id; s.style = dock().windowStyle },
    setStyle: (style: WindowStyle) => { dock().setWindowStyle(style); s.style = style },
    connections: run('connections'), saveAs: run('saveAs'), save: run('save'), restore: run('restore'), reset: run('reset'),
  }
}, {
  dock: DockId_,
  style: Style_,
  attach: { in: DockId_, description: 'Records the dock to drive and reads its current window style' },
  setStyle: { in: Style_, description: 'Sets the dock\'s window style' },
  connections: { description: 'Opens the dock\'s connections view' },
  saveAs: { description: 'Saves the dock\'s layout as a named workspace' },
  save: { description: 'Saves the dock\'s layout' },
  restore: { description: 'Restores the dock\'s saved layout' },
  reset: { description: 'Resets the dock to its initial layout' },
}, { description: 'The controls of one workspace dock' })

// 24×24 stroke paths, the File menu's icon style
const ICONS: Record<Command | 'more', ReturnType<typeof svg>> = {
  connections: svg`<circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.7 10.5l6.6-3M8.7 13.5l6.6 3"/>`,
  saveAs: svg`<path d="M12 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v4"/><path d="M7 3v5h8M18 15l3 3-5 5h-3v-3z"/>`,
  save: svg`<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8M7 21v-7h10v7"/>`,
  restore: svg`<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>`,
  reset: svg`<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>`,
  more: svg`<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>`,
}
const COMMANDS: [Command, string][] = [['connections', 'Connections'], ['saveAs', 'Save as workspace…'], ['save', 'Save layout'], ['restore', 'Restore'], ['reset', 'Reset']]
const NARROW = '(max-width: 840px)'

export class WorkspaceControlsEl extends PlacedElement {
  static component = WorkspaceControls
  static properties = { ...PlacedElement.properties, open: { state: true }, narrow: { state: true } }
  static styles = [base, css`
    :host { display: inline-flex; align-items: center; gap: 4px; position: relative; color: inherit }
    button { font: inherit; color: inherit; background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 4px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px }
    button:hover { background: color-mix(in srgb, currentColor 12%, transparent) }
    button:focus-visible { outline: 2px solid var(--nano-accent, #8FB3FF); outline-offset: 2px }
    svg { flex: none; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round }
    .view { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 8px }
    .view button { padding: 2px 8px }
    .view button[aria-pressed="true"] { background: color-mix(in srgb, currentColor 22%, transparent) }
    .panel { position: absolute; right: 0; top: calc(100% + 4px); z-index: 10; min-width: 12rem; display: flex; flex-direction: column; padding: 4px;
      background: var(--nano-surface, #131820); border: 1px solid var(--nano-border, #2A303C); border-radius: 8px }
    .panel[hidden] { display: none }
    .panel button { color: var(--nano-fg, #E6EAF0) }
    .panel button:hover { background: var(--nano-surface-2, #222933) }`]
  declare open: boolean
  declare narrow: boolean
  #mq?: MediaQueryList
  constructor() { super(); this.open = false; this.narrow = false }
  #outside = (e: Event) => { if (this.open && !e.composedPath().includes(this)) this.open = false }
  #match = () => { this.narrow = !!this.#mq?.matches; if (!this.narrow) this.open = false }

  firstUpdated() {
    this.addEventListener('keydown', e => { if (e.key === 'Escape' && this.open) this.#close(true) })
    this.addEventListener('focusout', e => { if (this.open && e.relatedTarget instanceof Node && !this.contains(e.relatedTarget)) this.open = false })
  }
  connectedCallback() {
    super.connectedCallback()
    document.addEventListener('click', this.#outside)
    this.#mq = matchMedia(NARROW); this.#mq.addEventListener('change', this.#match); this.#match()
  }
  disconnectedCallback() {
    super.disconnectedCallback()
    document.removeEventListener('click', this.#outside)
    this.#mq?.removeEventListener('change', this.#match)
  }

  #close(refocus: boolean) { this.open = false; if (refocus) void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('.more')?.focus()) }
  #run(c: Command) { void this.act(WorkspaceControls.ops[c]) }
  #cmd = (c: Command, label: string, text: boolean) => html`<button aria-label=${label} title=${label} @click=${() => { this.#close(false); this.#run(c) }}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[c]}</svg>${text ? label : ''}</button>`

  render() {
    const style = this.read<WindowStyle>(WorkspaceControls.ops.style) ?? 'tabs'
    return html`<span class="view" role="group" aria-label="View">${WINDOW_STYLES.map(w =>
        html`<button aria-pressed=${style === w.id ? 'true' : 'false'} @click=${() => { void this.act(WorkspaceControls.ops.setStyle, w.id) }}>${w.title}</button>`)}</span>
      ${this.narrow
        ? html`<button class="more" aria-label="More workspace actions" title="More workspace actions" aria-controls="panel" aria-expanded=${this.open ? 'true' : 'false'}
              @click=${() => { this.open = !this.open }}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.more}</svg></button>
            <div id="panel" class="panel" role="group" aria-label="Workspace actions" ?hidden=${!this.open}>${COMMANDS.map(([c, l]) => this.#cmd(c, l, true))}</div>`
        : COMMANDS.map(([c, l]) => this.#cmd(c, l, false))}`
  }
}

/** Registers `<nano-workspace-controls>`. */
export function defineWorkspaceControls() {
  if (!customElements.get('nano-workspace-controls')) customElements.define('nano-workspace-controls', WorkspaceControlsEl as unknown as CustomElementConstructor)
}
