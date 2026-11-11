// <nano-profile name="…">: an avatar button (image or initials) that opens a menu of the entries as links.
import { css, html } from 'lit'
import { base, PlacedElement } from '@pritzlaff/nano-elements'
import { FileMenuEl } from './file-menu-el'
import { initials, Profile, safeAvatar, type Entry, type User } from './profile'

export class ProfileEl extends PlacedElement {
  static component = Profile
  static properties = { ...PlacedElement.properties, open: { state: true } }
  static styles = [base, css`
    :host { display: inline-block; position: relative }
    button.avatar { width: 2rem; height: 2rem; padding: 0; border-radius: 50%; overflow: hidden; display: inline-flex; align-items: center; justify-content: center;
      background: var(--nano-surface-2, #222933); color: var(--nano-fg, #E6EAF0); border: 1px solid var(--nano-border, #2A303C); font-size: 0.8rem; cursor: pointer }
    button.avatar:focus-visible, a:focus-visible { outline: 2px solid var(--nano-accent, #8FB3FF); outline-offset: 2px }
    img { width: 100%; height: 100%; object-fit: cover }
    nav { position: absolute; right: 0; top: calc(100% + 4px); z-index: 10; min-width: 10rem; display: flex; flex-direction: column; padding: 4px;
      background: var(--nano-surface, #131820); border: 1px solid var(--nano-border, #2A303C); border-radius: 8px }
    nav[hidden] { display: none }
    a { padding: 6px 10px; border-radius: 6px; color: var(--nano-fg, #E6EAF0); text-decoration: none }
    a:hover { background: var(--nano-surface-2, #222933) }`]
  declare open: boolean
  constructor() { super(); this.open = false }
  #outside = (e: Event) => { if (this.open && !e.composedPath().includes(this)) this.open = false }

  firstUpdated() {
    this.addEventListener('keydown', e => { if (e.key === 'Escape' && this.open) this.#close(true) })
    this.addEventListener('focusout', e => { if (this.open && e.relatedTarget instanceof Node && !this.contains(e.relatedTarget)) this.open = false })   // null target: Safari/Firefox-mac don't focus links on click; outside clicks close via the document handler
  }
  connectedCallback() { super.connectedCallback(); document.addEventListener('click', this.#outside) }
  disconnectedCallback() { super.disconnectedCallback(); document.removeEventListener('click', this.#outside) }

  #close(refocus: boolean) { this.open = false; if (refocus) void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('button')?.focus()) }

  render() {
    const user = this.read<User>(Profile.ops.user) ?? { name: '' }, entries = this.read<Entry[]>(Profile.ops.entries) ?? []
    const src = safeAvatar(user.avatar)
    return html`<button class="avatar" aria-controls="panel" aria-expanded=${this.open ? 'true' : 'false'} aria-label=${user.name ? `Profile menu for ${user.name}` : 'Profile menu'}
        @click=${() => { this.open = !this.open }}>${src ? html`<img src=${src} alt="">` : initials(user.name)}</button>
      <nav id="panel" aria-label="Profile" ?hidden=${!this.open} @click=${() => this.#close(false)}>${entries.map(e => html`<a href=${e.href}>${e.label}</a>`)}</nav>`
  }
}

/** Registers `<nano-profile>` and `<nano-file-menu>`. */
export function defineShell() {
  if (!customElements.get('nano-profile')) customElements.define('nano-profile', ProfileEl as unknown as CustomElementConstructor)
  if (!customElements.get('nano-file-menu')) customElements.define('nano-file-menu', FileMenuEl)
}
