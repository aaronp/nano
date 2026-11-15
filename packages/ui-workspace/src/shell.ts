/**
 * `<workspace-shell>`: the host's page. File (Import URL, Save) above panels on split panes: the nano.ui built-ins,
 * Connect, `<nano-explorer>`, the opened pod's view (with its view and implementation pickers), `<nano-wiring>` and
 * the stream. Every change is an `apply` through `host`.
 */
import { LitElement, css, html, nothing } from 'lit'
import { port, type AppEvent } from '@pritzlaff/nano'
import { viewFor, type ViewTarget } from '@pritzlaff/nano-ui'
import { base, kit, t, toast } from '@pritzlaff/nano-elements'
import type { Host } from './host.ts'
import { createBus, provideBus } from './lib/bus.ts'
import './components/split-pane.ts'
import './components/theme-picker.ts'

/** The config a built-in starts with, where it needs one. */
const starts: Record<string, unknown> = { map: { code: 'return x' } }
type Pick = { from?: string; source?: string; to?: string; target?: string }
const value = (e: Event) => (e.target as HTMLElement & { value: string }).value

export class WorkspaceShell extends LitElement {
  static properties = { host: { attribute: false }, heading: {}, opened: { state: true }, events: { state: true }, pick: { state: true } }
  static styles = [base, kit, css`
    :host { display: flex; flex-direction: column; height: 100vh; background: ${t('bg')} }
    header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid ${t('border')} }
    h1 { font-size: 15px; margin: 0 12px 0 0 } header input { flex: 0 1 320px } theme-picker { margin-left: auto }
    split-pane { flex: 1; min-height: 0 } section { overflow: auto; padding: 10px; min-height: 0 }
    h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: ${t('muted')}; margin: 12px 0 6px }
    .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center }
    input { font: inherit; padding: 5px 8px; border: 1px solid ${t('border-strong')}; border-radius: ${t('radius-s')}; background: ${t('bg')}; color: ${t('fg')} }
    pre { font-family: ${t('font-mono')}; font-size: 11px; margin: 0; white-space: pre-wrap }`]
  declare host?: Host
  declare heading: string
  declare opened?: { runtime: string; pod: string }
  declare events: AppEvent[]
  declare pick: Pick
  private off?: () => void
  private listening?: Host
  private url = ''
  private shown?: { key: string; el: HTMLElement & { target?: ViewTarget } }

  constructor() { super(); this.heading = 'Nano'; this.events = []; this.pick = {}; provideBus(this, createBus()) }
  disconnectedCallback() { super.disconnectedCallback(); this.off?.(); this.listening = undefined }
  willUpdate() {
    if (!this.host || this.listening === this.host) return
    this.off?.()
    this.listening = this.host
    this.off = this.host.app.listen(e => { this.events = [...this.events, e].slice(-200) })   // the last 200
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
    URL.revokeObjectURL(a.href)
  }

  /** The opened pod's view element, made again only when its tag or pod changes. */
  private view(h: Host, at: { runtime: string; pod: string }) {
    const tag = viewFor(at.pod, h.data(), h.defaults()), key = `${tag} ${at.runtime} ${at.pod}`
    if (this.shown?.key !== key) this.shown = { key, el: document.createElement(tag) }
    this.shown.el.target = { app: h.app, registry: h.registry, runtime: at.runtime, pod: at.pod }
    return this.shown.el
  }

  private viewPanel(h: Host) {
    const at = this.opened, d = h.data(), p = at && d.pods[at.pod]
    if (!at || !p || !d.runtimes[at.runtime]?.pods.includes(at.pod)) return html`<p class="muted">Choose a pod in the explorer.</p>`
    const tags = [...new Set([h.defaults()[p.implementation], 'nano-pod-view'].filter((x): x is string => !!x))]
    const same = (a: readonly string[]) => [...a].sort().join()
    const mine = same(h.registry.implementation(p.implementation)?.provides.map(i => i.coord) ?? [])
    const impls = h.registry.manifest().implementations.filter(i => same(i.provides) === mine).map(i => i.coord)
    return html`<div class="row"><b>${at.pod}</b>
        <nano-select label="View" .options=${tags} .value=${viewFor(at.pod, d, h.defaults())}
          @change=${(e: Event) => h.apply({ ...d, views: { ...d.views, [at.pod]: value(e) } })}></nano-select>
        <nano-select label="Change implementation" .options=${impls} .value=${p.implementation}
          @change=${(e: Event) => this.swap(h, at.pod, value(e))}></nano-select></div>
      ${this.view(h, at)}`
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
    const target = { app: h.app, registry: h.registry }
    return html`<header><h1>${this.heading}</h1>
        <input aria-label="nano.json URL" placeholder="nano.json URL" @input=${(e: Event) => { this.url = value(e) }}>
        <button @click=${() => this.url && h.importUrl(this.url)}>Import URL</button><button @click=${() => this.save(h)}>Save</button>
        <theme-picker></theme-picker></header>
      <split-pane sizes="1,2,1" storage-key="workspace">
        <section><h2>Built-ins</h2><div class="row">${kinds.map(k => html`<button data-builtin @click=${() => this.add(h, k)}>${k}</button>`)}</div>
          <h2>Connect</h2>${this.connectPanel(h)}
          <h2>Explorer</h2><nano-explorer .target=${target} @nano-open=${(e: CustomEvent<{ runtime: string; pod: string }>) => { this.opened = e.detail }}></nano-explorer></section>
        <section><h2>View</h2>${this.viewPanel(h)}<h2>Wiring</h2><nano-wiring .target=${target}></nano-wiring></section>
        <section><h2>Stream</h2><pre>${this.events.map(e => JSON.stringify(e)).join('\n')}</pre></section>
      </split-pane>`
  }
}

if (!customElements.get('workspace-shell')) customElements.define('workspace-shell', WorkspaceShell)
