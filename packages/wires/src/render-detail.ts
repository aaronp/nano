// The drawer's Detail tab: the system tree (<c-platform>, which the host defines), and a card for what is selected —
// a component (its coordinates, kind, jacks and connections) or one of its actions (its op, schemas and connections).
import { html } from 'lit'
import { Ops, type Op, type Subscription } from '@pritzlaff/nano-core'
import { examplesOf, runtimeOf, viewIds } from '@composable/platform'
import type { Vals } from './render-root'
import type { Wires } from './wires'

const name = (key: string) => key.slice(key.lastIndexOf('/') + 1)
const row = (label: string, value: unknown) => html`<div style="display:grid; grid-template-columns:96px 1fr; gap:8px"><span style="color:#8B96A5">${label}</span><span class="mono" style="overflow-wrap:anywhere">${value}</span></div>`
const h3 = (text: string) => html`<h3 style="margin:8px 0 2px; font-size:11px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#8B96A5">${text}</h3>`
const about = (s: unknown) => {
  const d = (s as { description?: string } | undefined)?.description, e = examplesOf(s as never)
  return html`${d ? html`<div>${d}</div>` : ''}${e ? html`<div class="mono" style="color:#8B96A5">e.g. ${e}</div>` : ''}`
}
const schema = (s: unknown) => s === undefined ? html`<span class="mono" style="color:#8B96A5">none</span>`
  : html`${about(s)}<pre class="mono" style="margin:0; padding:8px; border-radius:6px; background:#0A0D11; border:1px solid #1F252E; font-size:11px; max-height:160px; overflow:auto">${JSON.stringify(s, null, 2)}</pre>`
const cord = (c: Subscription) => html`<div class="mono">${c.source}.${name(c.op)} → ${c.listener}.${name(c.target)}</div>`

export function renderDetail(el: Wires, d: Vals) {
  // the selection may be in any system: look it up through the platform, where the tree lives too
  const sel = d.s.picked, home = (el.host ?? el.runtime)?.registry
  const reg = sel && home ? runtimeOf(home, sel.system, el.platform)?.registry : el.runtime?.registry
  const snap = reg?.snapshot(), views = snap ? viewIds(snap) : new Set<string>()
  const subs = (snap?.subscriptions ?? []).filter(c => !views.has(c.listener))
  const inst = sel && reg?.get(sel.instance)
  const card = !sel ? html`<p style="margin:0; color:#8B96A5">Click a panel, module or jack on the back, or an item in the tree.</p>`
    : !inst ? html`<p style="margin:0; color:#8B96A5">${sel.instance} is no longer in ${sel.system}.</p>`
    : sel.op ? action(sel.system, sel.instance, inst.actions.get(sel.op)?.op, sel.op, subs)
    : component(el, sel.system, sel.instance, `${inst.component.id.ns}/${inst.component.id.name}`, [...inst.actions.values()].map(a => a.op), subs)
  return html`<section style="display:flex; flex-direction:column; gap:14px">
    <c-platform .registry=${home} model=${el.platform}></c-platform>
    <div class="detail" style="display:flex; flex-direction:column; gap:6px; font-size:12px; color:#C9D1D9">${card}</div>
  </section>`
}

function component(el: Wires, system: string, instance: string, id: string, ops: Op[], subs: Subscription[]) {
  const mine = subs.filter(c => c.source === instance || c.listener === instance)
  return html`
    ${row('Coordinates', `${system} / ${instance}`)}${row('Kind', el.kindOf(instance) ?? '—')}${row('Component', id)}
    ${h3('Jacks')}${ops.map(o => html`<div class="mono">${o.input ? 'in ' : 'out'} ${o.name}</div>`)}
    ${h3('Connections')}${mine.length ? mine.map(cord) : html`<span style="color:#8B96A5">none</span>`}`
}

function action(system: string, instance: string, op: Op | undefined, key: string, subs: Subscription[]) {
  if (!op) return html`<p style="margin:0; color:#8B96A5">${instance} no longer has ${key}.</p>`
  const mine = subs.filter(c => (c.source === instance && c.op === key) || (c.listener === instance && c.target === key))
  return html`
    ${row('Coordinates', `${system} / ${instance}`)}${row('Op', Ops.key(op))}${row('Kind', op.input ? 'action' : 'source')}
    ${op.description ? row('Description', op.description) : ''}
    ${h3('Input')}${schema(op.input)}${h3('Output')}${schema(op.output)}
    ${h3('Connections')}${mine.length ? mine.map(cord) : html`<span style="color:#8B96A5">none</span>`}`
}
