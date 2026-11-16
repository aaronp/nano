/**
 * `<workspace-app-bar>`: the title (what HostUI's `setAppBar` last set) and the File and View menus. A choice fires
 * `nano-command` (detail: the command); what each does is up to whoever listens.
 */
import { LitElement, css, html } from 'lit'
import '@pritzlaff/nano-elements'   // defines nano-menu
import type { MenuItem, NanoMenu } from '@pritzlaff/nano-elements'
import type { Host } from '../host.ts'

const item = (label: string, value: string): MenuItem => ({ label, value })
const menus: [string, MenuItem[]][] = [
  ['File', [item('New', 'new'), item('Import…', 'import'), item('Open…', 'open'), { separator: true }, item('Save', 'save'), item('Save as…', 'save-as')]],
  ['View', [item('Tabs', 'tabs'), item('Clear', 'clear'), { separator: true }, item('Save layout', 'save-layout'), item('Restore layout', 'restore'), item('Reset layout', 'reset')]],
]

class WorkspaceAppBar extends LitElement {
  static properties = { host: { attribute: false }, heading: {} }
  static styles = css`
    :host { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0 }
    .title { font: 600 16px/1.2 var(--display); margin-right: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
    button { font: inherit; color: inherit; background: transparent; border: 0; border-radius: var(--radius); padding: 6px 10px; cursor: pointer }
    button:hover { background: color-mix(in srgb, currentColor 14%, transparent) }`
  declare host?: Host
  declare heading: string
  constructor() { super(); this.heading = 'Nano' }

  private command(e: CustomEvent<MenuItem & { value: string }>) {
    this.dispatchEvent(new CustomEvent('nano-command', { detail: e.detail.value, bubbles: true, composed: true }))
  }

  render() {
    return html`<span class="title">${this.heading}</span>${menus.map(([name, items]) => html`<nano-menu .items=${items} @pick=${this.command}>
      <button aria-haspopup="menu" @click=${(e: MouseEvent) => { const b = e.currentTarget as HTMLElement, r = b.getBoundingClientRect(); void b.closest<NanoMenu>('nano-menu')?.show({ x: r.left, y: r.bottom }) }}>${name}</button></nano-menu>`)}`
  }
}

customElements.define('workspace-app-bar', WorkspaceAppBar)
