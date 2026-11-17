// The drawer's Detail tab: the app's tree (nano-ui's <nano-explorer>), and a card for what is selected — a component
// (its coordinates, kind, jacks and connections) or one of its ports (its op, schemas and connections).
import { html } from 'lit'
import type { Op } from '@pritzlaff/nano-core'
import { jacksOfImpl, snapshotOf, type Jack } from './model'
import type { Vals } from './render-root'
import type { Wires } from './wires'

const name = (key: string) => key.slice(key.lastIndexOf('/') + 1)
const row = (label: string, value: unknown) => html`<div style="display:grid; grid-template-columns:96px 1fr; gap:8px"><span style="color:#8B96A5">${label}</span><span class="mono" style="overflow-wrap:anywhere">${value}</span></div>`
const h3 = (text: string) => html`<h3 style="margin:8px 0 2px; font-size:11px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#8B96A5">${text}</h3>`
// BACKLOG(6): @composable/platform's examplesOf ("e.g. …") is gone; only a schema's description is shown.
const about = (s: unknown) => {
  const d = (s as { description?: string } | undefined)?.description
  return html`${d ? html`<div>${d}</div>` : ''}`
}
type Subscription = { source: string; op: string; listener: string; target: string }
const schema = (s: unknown) => s === undefined ? html`<span class="mono" style="color:#8B96A5">none</span>`
  : html`${about(s)}<pre class="mono" style="margin:0; padding:8px; border-radius:6px; background:#0A0D11; border:1px solid #1F252E; font-size:11px; max-height:160px; overflow:auto">${JSON.stringify(s, null, 2)}</pre>`
const bare = (key: string) => key.replace(/:(in|out)$/, '')
const cord = (c: Subscription) => html`<div class="mono">${c.source}.${name(bare(c.op))} → ${c.listener}.${name(bare(c.target))}</div>`

export function renderDetail(el: Wires, d: Vals) {
  // the selection is a pod of the app's deployment
  const sel = d.s.picked, h = el.host, data = h?.data()
  const subs = data && h ? snapshotOf(data, h.registry).subscriptions : []
  const pod = sel && data?.pods[sel.instance], jacks = pod && h ? jacksOfImpl(h.registry.implementation(pod.implementation)) : []
  const card = !sel ? html`<p style="margin:0; color:#8B96A5">Click a panel, module or jack on the back, or an item in the tree.</p>`
    : !pod ? html`<p style="margin:0; color:#8B96A5">${sel.instance} is no longer in ${sel.system}.</p>`
    : sel.op ? action(sel.system, sel.instance, jacks.find(j => j.port === sel.op)?.op, sel.op, subs)
    : component(el, sel.system, sel.instance, pod.implementation, jacks, subs)
  return html`<section style="display:flex; flex-direction:column; gap:14px">
    <nano-explorer .target=${h && { app: h.app, registry: h.registry }}></nano-explorer>
    <div class="detail" style="display:flex; flex-direction:column; gap:6px; font-size:12px; color:#C9D1D9">${card}</div>
  </section>`
}

function component(el: Wires, system: string, instance: string, id: string, ops: Jack[], subs: Subscription[]) {
  const mine = subs.filter(c => c.source === instance || c.listener === instance)
  return html`
    ${row('Coordinates', `${system} / ${instance}`)}${row('Kind', el.kindOf(instance) ?? '—')}${row('Component', id)}
    ${h3('Jacks')}${ops.map(o => html`<div class="mono">${o.dir === 'in' ? 'in ' : 'out'} ${o.op.name}</div>`)}
    ${h3('Connections')}${mine.length ? mine.map(cord) : html`<span style="color:#8B96A5">none</span>`}`
}

function action(system: string, instance: string, op: Op | undefined, key: string, subs: Subscription[]) {
  if (!op) return html`<p style="margin:0; color:#8B96A5">${instance} no longer has ${key}.</p>`
  const mine = subs.filter(c => (c.source === instance && bare(c.op) === key) || (c.listener === instance && bare(c.target) === key))
  return html`
    ${row('Coordinates', `${system} / ${instance}`)}${row('Op', key)}${row('Kind', op.kind === 'action' ? 'action' : 'source')}
    ${op.description ? row('Description', op.description) : ''}
    ${h3('Input')}${schema(op.input?.schema)}${h3('Output')}${schema(op.output?.schema)}
    ${h3('Connections')}${mine.length ? mine.map(cord) : html`<span style="color:#8B96A5">none</span>`}`
}
