/**
 * `<nano-settings>`: the system-wide decisions in force, read-only: each runtime's Policy (its rules, in the order
 * they are tried), each pod's isolation and the frame permissions of each isolation mode, and where each provider's
 * code (and frame page) comes from. It follows the live deployment. Editing is later (BACKLOG(14)).
 *
 *   el.host = host
 */
import { LitElement, css, html, nothing } from 'lit'
import type { Rule } from '@pritzlaff/nano-core'
import type { Host } from '../host.ts'
import { foreignOrigin } from '../import.ts'
import { FRAME_POLICY } from '../sandbox/frames.ts'

const kinds = (k: unknown) => Array.isArray(k) ? k.join(', ') : String(k)
const target = (r: Rule) => r.toPort ?? r.toInterface ?? r.toPod ?? '*'
const where = (url: string) => foreignOrigin(url) ?? 'this origin'

export class SettingsView extends LitElement {
  static properties = { host: { attribute: false }, tick: { state: true } }
  static styles = css`
    :host { display: block }
    section { margin: 0 0 20px } h2 { margin: 0 0 6px; font-size: 15px } h3 { margin: 12px 0 4px; font-size: 13px; font-family: var(--mono, monospace) }
    p { margin: 0 0 8px; color: var(--muted); font-size: 13px }
    table { border-collapse: collapse; width: 100%; font-size: 12px } th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--line, rgba(128,128,128,.25)); vertical-align: top }
    th { color: var(--muted); font-weight: 600 } code { font-family: var(--mono, monospace) } .allow { color: var(--good, #2a8a3e) } .deny { color: var(--bad, #c33) }`
  declare host?: Host
  declare tick: number
  private off?: () => void
  constructor() { super(); this.tick = 0 }
  updated(changed: Map<string, unknown>) {
    if (!changed.has('host')) return
    this.off?.()
    this.off = this.host?.app.listen(e => { if (e.type === 'applied') this.tick++ })
  }
  disconnectedCallback() { super.disconnectedCallback(); this.off?.(); this.off = undefined }

  private policies() {
    const d = this.host!.data()
    return Object.entries(d.runtimes).map(([id, r]) => html`<h3>${id}</h3>${
      !r.policy ? html`<p>No policy: every message is allowed.</p>`
      : r.policy.kind === 'allow-all' ? html`<p>allow-all: every message is allowed.</p>`
      : html`<p>The first rule that matches decides; when none does, the message is denied.</p><table><thead><tr><th>#</th><th>decision</th><th>kinds</th><th>from</th><th>to</th><th>outside</th></tr></thead><tbody>
        ${r.policy.rules.map((rule, i) => { const allow = 'allow' in rule; return html`<tr><td>${i + 1}</td><td class=${allow ? 'allow' : 'deny'}>${allow ? 'allow' : 'deny'}</td>
          <td><code>${kinds(allow ? rule.allow : rule.deny)}</code></td><td><code>${rule.from ?? '*'}</code></td><td><code>${target(rule)}</code></td><td>${rule.outside === undefined ? 'either' : rule.outside ? 'yes' : 'no'}</td></tr>` })}
      </tbody></table>`}`)
  }

  render() {
    if (!this.host) return html``
    const d = this.host.data()
    const isolated = Object.entries(d.pods).filter(([, p]) => (p.isolation ?? 'host') !== 'host')
    return html`<section><h2>Policies</h2><p>What each runtime lets travel between its pods (and from the host).</p>${this.policies()}</section>
      <section><h2>Isolation</h2><p>Pods outside this page, and what their frames may do. Every other pod runs in this page, with its full access.</p>
        ${isolated.length ? html`<table><thead><tr><th>pod</th><th>isolation</th></tr></thead><tbody>${isolated.map(([n, p]) => html`<tr><td><code>${n}</code></td><td>${p.isolation}</td></tr>`)}</tbody></table>` : html`<p>None: every pod runs in this page.</p>`}
        <table><thead><tr><th>isolation</th><th>iframe sandbox</th><th>allow</th></tr></thead><tbody>
          ${Object.entries(FRAME_POLICY).map(([m, f]) => html`<tr><td>${m}</td><td><code>${f.sandbox}</code></td><td>${f.allow ? html`<code>${f.allow}</code>` : 'nothing'}</td></tr>`)}
        </tbody></table></section>
      <section><h2>Providers</h2><p>Where each provider's code is loaded from${d.frames ? ', and its own frame page' : ''}.</p>
        <table><thead><tr><th>provider</th><th>module</th><th>origin</th>${d.frames ? html`<th>frame page</th>` : nothing}</tr></thead><tbody>
          ${Object.entries(d.modules ?? {}).map(([c, u]) => html`<tr><td><code>${c}</code></td><td><code>${u}</code></td><td>${where(u)}</td>${d.frames ? html`<td>${d.frames[c] ? html`<code>${d.frames[c]}</code>` : ''}</td>` : nothing}</tr>`)}
        </tbody></table></section>`
  }
}

export function defineSettings() { if (!customElements.get('nano-settings')) customElements.define('nano-settings', SettingsView) }
