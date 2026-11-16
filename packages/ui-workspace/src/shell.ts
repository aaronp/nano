/**
 * `<workspace-shell>`: the host's page. File (Import URL, Save), the nano.ui built-ins, Connect, and the view and
 * implementation pickers of the pod last opened in the explorer, above its children (the dock). Every change is an
 * `apply` through `host`.
 */
import { LitElement, css, html, nothing } from 'lit'
import { port } from '@pritzlaff/nano-core'
import { base, kit, t, toast } from '@pritzlaff/nano-elements'
import type { Host } from './host.ts'
import { createBus, provideBus } from './lib/bus.ts'
import { chosen, viewTags } from './dock/panels.ts'
import './components/theme-picker.ts'

/** The config a built-in starts with, where it needs one. */
const starts: Record<string, unknown> = { map: { code: 'return x' } }
type Pick = { from?: string; source?: string; to?: string; target?: string }
const value = (e: Event) => (e.target as HTMLElement & { value: string }).value

class WorkspaceShell extends LitElement {
  static properties = { host: { attribute: false }, heading: {}, opened: { state: true }, pick: { state: true } }
  static styles = [base, kit, css`
    :host { display: flex; flex-direction: column; height: 100%; background: ${t('bg')} }
    header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid ${t('border')} }
    h1 { font-size: 15px; margin: 0 12px 0 0 } header input { flex: 0 1 320px } theme-picker { margin-left: auto }
    section { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 6px 12px; border-bottom: 1px solid ${t('border')} }
    ::slotted(*) { flex: 1; min-height: 0 }
    .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center }
    input { font: inherit; padding: 5px 8px; border: 1px solid ${t('border-strong')}; border-radius: ${t('radius-s')}; background: ${t('bg')}; color: ${t('fg')} }`]
  declare host?: Host
  declare heading: string
  declare opened?: { runtime: string; pod: string }
  declare pick: Pick
  private off?: () => void
  private listening?: Host
  private url = ''

  constructor() {
    super(); this.heading = 'Nano'; this.pick = {}; provideBus(this, createBus())
    this.addEventListener('nano-open', e => { this.opened = (e as CustomEvent<{ runtime: string; pod: string }>).detail })
  }
  connectedCallback() { super.connectedCallback(); this.requestUpdate() }   // listens again (willUpdate) after a re-attach
  disconnectedCallback() { super.disconnectedCallback(); this.off?.(); this.listening = undefined }
  willUpdate() {
    if (!this.host || this.listening === this.host) return
    this.off?.()
    this.listening = this.host
    this.off = this.host.app.listen(e => { if (e.type === 'applied') this.requestUpdate() })   // the pickers follow
  }

  private async add(h: Host, kind: string) {
    const d = h.data(), impl = h.registry.implementation(`nano.ui/${kind}`)!
    let n = 1
    while (`${kind}${n}` in d.pods) n++
    const pod = { implementation: impl.coord, eager: true, ...(starts[kind] !== undefined && { config: starts[kind] }) }
    const main = d.runtimes.main ?? { pods: [], subscriptions: [] }
    await h.apply({ ...d, pods: { ...d.pods, [`${kind}${n}`]: pod }, runtimes: { ...d.runtimes, main: { ...main, pods: [...main.pods, `${kind}${n}`] } } })
  }

  private ports(h: Host, pod?: string): string[] {
    const impl = pod === undefined ? undefined : h.registry.implementation(h.data().pods[pod]?.implementation ?? '')
    return impl?.provides.flatMap(i => Object.values(i.ops).map(o => port(i, o))) ?? []
  }

  private async connect(h: Host) {
    const { from, source, to, target } = this.pick, d = h.data()
    if (!from || !source || !to || !target) return void toast('Choose a source pod and op, and a target pod and op')
    const rt = Object.entries(d.runtimes).find(([, r]) => r.pods.includes(from) && r.pods.includes(to))
    if (!rt) return void toast(`${from} and ${to} share no runtime`, { variant: 'bad' })
    const [id, r] = rt
    await h.apply({ ...d, runtimes: { ...d.runtimes, [id]: { ...r, subscriptions: [...r.subscriptions, { kind: 'pipe', from, source, to, target }] } } })
  }

  private async swap(h: Host, pod: string, coord: string) {
    const d = h.data(), p = d.pods[pod]!, keeps = h.registry.implementation(coord)?.config?.check(p.config)
    await h.apply({ ...d, pods: { ...d.pods, [pod]: { implementation: coord, eager: p.eager, ...(keeps && { config: p.config }) } } })
  }

  private save(h: Host) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(h.saved(), null, 2) + '\n'], { type: 'application/json' }))
    a.download = 'nano.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href))   // after the download has started
  }

  private viewPanel(h: Host) {
    const at = this.opened, d = h.data(), p = at && d.pods[at.pod]
    if (!at || !p || !d.runtimes[at.runtime]?.pods.includes(at.pod)) return nothing
    const tags = viewTags(h, at.pod, p.implementation)
    const same = (a: readonly string[]) => [...a].sort().join()
    const mine = same(h.registry.implementation(p.implementation)?.provides.map(i => i.coord) ?? [])
    const impls = h.registry.manifest().implementations.filter(i => same(i.provides) === mine).map(i => i.coord)
    return html`<div class="row"><b>${at.pod}</b>
        <nano-select label="View" .options=${tags} .value=${chosen(h, at.pod)}
          @change=${(e: Event) => h.apply({ ...d, views: { ...d.views, [at.pod]: value(e) } })}></nano-select>
        <nano-select label="Change implementation" .options=${impls} .value=${p.implementation}
          @change=${(e: Event) => this.swap(h, at.pod, value(e))}></nano-select></div>`
  }

  private connectPanel(h: Host) {
    const pods = Object.keys(h.data().pods), set = (k: keyof Pick) => (e: Event) => { this.pick = { ...this.pick, [k]: value(e) } }
    return html`<div class="row">
      <nano-select label="Source pod" placeholder="Source pod" .options=${pods} .value=${this.pick.from ?? ''} @change=${set('from')}></nano-select>
      <nano-select label="Source op" placeholder="Source op" .options=${this.ports(h, this.pick.from)} .value=${this.pick.source ?? ''} @change=${set('source')}></nano-select>
      <nano-select label="Target pod" placeholder="Target pod" .options=${pods} .value=${this.pick.to ?? ''} @change=${set('to')}></nano-select>
      <nano-select label="Target op" placeholder="Target op" .options=${this.ports(h, this.pick.to)} .value=${this.pick.target ?? ''} @change=${set('target')}></nano-select>
      <button @click=${() => this.connect(h)}>Connect</button></div>`
  }

  render() {
    const h = this.host
    if (!h) return nothing
    const kinds = [...(h.registry.provider('nano.ui')?.implementations.keys() ?? [])].map(c => c.slice(c.indexOf('/') + 1))
    return html`<header><h1>${this.heading}</h1>
        <input aria-label="nano.json URL" placeholder="nano.json URL" @input=${(e: Event) => { this.url = value(e) }}>
        <button @click=${() => this.url && h.importUrl(this.url)}>Import URL</button><button @click=${() => this.save(h)}>Save</button>
        <theme-picker></theme-picker></header>
      <section><div class="row">${kinds.map(k => html`<button data-builtin @click=${() => this.add(h, k)}>${k}</button>`)}</div>
        ${this.connectPanel(h)}${this.viewPanel(h)}</section><slot></slot>`
  }
}

if (!customElements.get('workspace-shell')) customElements.define('workspace-shell', WorkspaceShell)
