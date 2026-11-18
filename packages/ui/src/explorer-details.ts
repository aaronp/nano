/**
 * The explorer's details pane: what one selected node is, from the live deployment and the registry. Ids name the
 * node: `r:<runtime>`, `p:<runtime>:<pod>`, `s:<runtime>:<pod>:<i>` (that pod's i-th subscription), `i:<interface>`,
 * `m:<implementation>`. `go(id)` selects another node (a link); `open(where)` asks the host for a pod's view.
 */
import { html, nothing, type TemplateResult } from 'lit'
import type { AppDeployment, Registry } from '@pritzlaff/nano-core'

export type Where = { runtime: string; pod: string }
type Ctx = { d: AppDeployment; registry: Registry; states: Record<string, string>; go(id: string): void; open(w: Where): void }

const op = (port: string) => port.slice(port.lastIndexOf('/') + 1)
const row = (k: string, v: unknown) => html`<dt>${k}</dt><dd>${v}</dd>`
const link = (c: Ctx, id: string, label: string) => html`<a href="#" @click=${(e: Event) => { e.preventDefault(); c.go(id) }}>${label}</a>`
const list = (items: unknown[]) => items.length ? html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>` : html`<span class="muted">none</span>`
/** The runtimes `pod` is placed in. */
const placed = (d: AppDeployment, pod: string) => Object.keys(d.runtimes).filter(r => d.runtimes[r]!.pods.includes(pod))
const podLink = (c: Ctx, pod: string) => { const r = placed(c.d, pod)[0]; return r ? link(c, `p:${r}:${pod}`, pod) : pod }

function pod(c: Ctx, runtime: string, name: string) {
  const p = c.d.pods[name]
  if (!p) return html`<p class="muted">${name} is no longer deployed.</p>`
  const impl = c.registry.implementation(p.implementation)
  const subs = Object.entries(c.d.runtimes).flatMap(([r, rt]) => rt.subscriptions.map(s => ({ r, s })))
  const calls = subs.filter(({ s }) => s.kind === 'call' && s.from === name).map(({ s }) => s.to)
  const needs = Object.entries(impl?.dependencies ?? {}).map(([role, sel]) => {
    const to = calls.find(t => { const i = c.registry.implementation(c.d.pods[t]?.implementation ?? ''); return !sel.implements || i?.provides.some(x => x.coord === sel.implements) })
    return html`${role} (${sel.implements ?? 'any'}) → ${to ? podLink(c, to) : html`<span class="warn">not connected</span>`}`
  })
  return html`<h3>pod ${name}</h3><dl>
    ${row('implementation', link(c, `m:${p.implementation}`, p.implementation))}
    ${row('runtimes', placed(c.d, name).map((r, i) => html`${i ? ', ' : ''}${link(c, `r:${r}`, r)}`))}
    ${row('isolation', p.isolation ?? 'host')}${row('starts', p.eager ? 'eager' : 'lazy')}${row('state', c.states[name] ?? 'not built')}
    ${row('config', p.config === undefined ? html`<span class="muted">none</span>` : html`<code>${JSON.stringify(p.config)}</code>`)}
    ${row('needs', list(needs))}
    ${row('called by', list(subs.filter(({ s }) => s.kind === 'call' && s.to === name).map(({ s }) => podLink(c, s.from))))}
    ${row('pipes', list(subs.filter(({ s }) => s.kind === 'pipe' && (s.from === name || s.to === name)).map(({ s }) => s.kind === 'pipe' ? `${s.from}.${op(s.source)} → ${s.to}.${op(s.target)}` : '')))}
  </dl><button class="btn" @click=${() => c.open({ runtime, pod: name })}>Open view</button>`
}

function runtime(c: Ctx, id: string) {
  const r = c.d.runtimes[id]
  if (!r) return html`<p class="muted">${id} is no longer deployed.</p>`
  return html`<h3>runtime ${id}</h3><dl>
    ${row('pods', list(r.pods.map(p => link(c, `p:${id}:${p}`, p))))}
    ${row('call edges', list(r.subscriptions.flatMap(s => s.kind === 'call' ? [html`${podLink(c, s.from)} → ${podLink(c, s.to)}`] : [])))}
    ${row('pipes', list(r.subscriptions.flatMap(s => s.kind === 'pipe' ? [`${s.from}.${op(s.source)} → ${s.to}.${op(s.target)}`] : [])))}
    ${row('policy', !r.policy ? 'none (everything allowed)' : r.policy.kind === 'rules' ? `${r.policy.rules.length} rules (see Settings)` : r.policy.kind)}
  </dl>`
}

function subscription(c: Ctx, runtime: string, pod: string, i: number) {
  const s = c.d.runtimes[runtime]?.subscriptions.filter(x => x.from === pod)[i]
  if (!s) return html`<p class="muted">That subscription is no longer deployed.</p>`
  return html`<h3>${s.kind === 'call' ? 'call edge' : 'pipe'}</h3><dl>
    ${row('runtime', link(c, `r:${runtime}`, runtime))}${row('from', podLink(c, s.from))}${row('to', podLink(c, s.to))}
    ${s.kind === 'pipe' ? html`${row('source', s.source)}${row('target', s.target)}` : nothing}
  </dl>${s.kind === 'call' ? html`<button class="btn" @click=${() => c.open({ runtime: placed(c.d, s.to)[0] ?? runtime, pod: s.to })}>Open ${s.to}</button>` : nothing}`
}

function iface(c: Ctx, coord: string) {
  const i = c.registry.manifest().interfaces.find(x => x.coord === coord)
  if (!i) return html`<p class="muted">${coord} is not registered.</p>`
  return html`<h3>interface ${coord}</h3><dl>
    ${row('ops', list(i.ops.map(o => html`<code>${o.name}</code> ${o.kind}${o.input ? html` <span class="muted">${o.input} → ${o.output ?? ''}</span>` : nothing}`)))}
    ${row('implementations', list(c.registry.implementationsOf(coord).map(m => link(c, `m:${m.coord}`, m.coord))))}
  </dl>`
}

function implementation(c: Ctx, coord: string) {
  const m = c.registry.implementation(coord)
  if (!m) return html`<p class="muted">${coord} is not registered.</p>`
  return html`<h3>implementation ${coord}</h3>${m.description ? html`<p>${m.description}</p>` : nothing}<dl>
    ${row('provider', m.provider)}
    ${row('provides', list(m.provides.map(i => link(c, `i:${i.coord}`, i.coord))))}
    ${row('needs', list(Object.entries(m.dependencies).map(([role, s]) => html`${role}: ${s.implements ? link(c, `i:${s.implements}`, s.implements) : JSON.stringify(s)}`)))}
    ${row('pods', list(Object.entries(c.d.pods).filter(([, p]) => p.implementation === coord).map(([n]) => podLink(c, n))))}
  </dl>`
}

/** The details of node `id`, or a hint when nothing is selected. */
export function details(c: Ctx, id: string | null): TemplateResult {
  if (!id) return html`<p class="muted">Select a runtime, pod, subscription, interface or implementation.</p>`
  const [kind, ...rest] = id.split(':'), at = rest.join(':')
  if (kind === 'r') return runtime(c, at)
  if (kind === 'p') return pod(c, rest[0]!, rest.slice(1).join(':'))
  if (kind === 's') return subscription(c, rest[0]!, rest[1]!, Number(rest[2]))
  if (kind === 'i') return iface(c, at)
  if (kind === 'm') return implementation(c, at)
  return html``
}
