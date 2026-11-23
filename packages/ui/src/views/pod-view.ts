/**
 * `<nano-pod-view>`: any pod, generically — its name, implementation, config and runtimes, each interface it provides
 * with each op's name and kind, and per port the calls to it and the last result delivered.
 */
import { css, html } from 'lit'
import type { AppEvent, NanoResult } from '@pritzlaff/nano-core'
import { base, t } from '@pritzlaff/nano-elements'
import { shown, ViewElement, type ViewTarget } from './view.ts'

export class NanoPodView extends ViewElement {
  static styles = [base, css`
    dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0 0 12px }
    dt { color: ${t('muted')} } dd { margin: 0; font-family: ${t('font-mono')} }
    table { width: 100%; border-collapse: collapse } td { padding: 3px 6px; border-top: 1px solid ${t('border')} }
    .iface { margin-top: 8px; font-weight: 600 }
  `]
  private ports = new Map<string, string>()
  private stats = new Map<string, { calls: number; last?: NanoResult<unknown> }>()

  protected started() { this.ports.clear(); this.stats.clear(); this.requestUpdate() }

  protected hear(e: AppEvent, tg: ViewTarget) {
    if (e.type === 'sent' && e.kind !== 'start' && e.to === tg.pod) {
      this.ports.set(e.id, e.port)
      const s = this.stats.get(e.port) ?? { calls: 0 }
      this.stats.set(e.port, { ...s, calls: s.calls + 1 })
    } else if ((e.type === 'delivered' || e.type === 'denied') && this.ports.has(e.id)) {
      const p = this.ports.get(e.id)!
      this.ports.delete(e.id)
      if (e.type === 'delivered') this.stats.set(p, { ...this.stats.get(p)!, last: e.result })
    } else return
    this.requestUpdate()
  }

  protected face(tg: ViewTarget) {
    const d = tg.app.deployment()
    const pod = d.pods[tg.pod]
    const runtimes = Object.entries(d.runtimes).filter(([, r]) => r.pods.includes(tg.pod)).map(([id]) => id)
    const provides = tg.registry.implementation(pod?.implementation ?? '')?.provides ?? []
    return html`
      <dl>
        <dt>pod</dt><dd>${tg.pod}</dd>
        <dt>implementation</dt><dd>${pod?.implementation ?? '—'}</dd>
        <dt>config</dt><dd>${JSON.stringify(pod?.config ?? null)}</dd>
        <dt>runtimes</dt><dd>${runtimes.join(', ') || '—'}</dd>
      </dl>
      ${provides.map(i => html`
        <div class="iface">${i.coord}</div>
        <table>${Object.values(i.ops).map(o => {
          const p = `${i.coord}/${o.name}`, s = this.stats.get(p)
          return html`<tr data-port=${p}><td>${o.name}</td><td class="badge">${o.kind}</td>
            <td>${s?.calls ?? 0} calls</td><td>${shown(s?.last)}</td></tr>`
        })}</table>`)}`
  }
}
