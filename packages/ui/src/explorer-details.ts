/**
 * The explorer's details pane: what one selected node is, from the live deployment and the registry. Ids name the
 * node: `r:<runtime>`, `p:<runtime>:<pod>`, `s:<runtime>:<pod>:<i>` (that pod's i-th subscription), `i:<interface>`,
 * `m:<implementation>`, `o:<interface>/<op>`. `go(id)` selects another node (a link); `open(where)` asks the host for a pod's view; `remove(runtime)` asks it to delete a runtime.
 */
import { html, nothing, type TemplateResult } from 'lit'
import type { AppDeployment, Registry, Subscription } from '@pritzlaff/nano-core'

export type Where = { runtime: string; pod: string }
/** An op-level call (ui-workspace's OpCall, structurally): `from`'s op `source` (null: unknown) calls `to`'s `target`. */
export type Called = { runtime: string; from: string; to: string; source: string | null; target: string; declared: boolean; seen: boolean }
type Ctx = { d: AppDeployment; registry: Registry; status(runtime: string, pod: string): string; calls?: Called[]; go(id: string): void; open(w: Where): void; remove(runtime: string): void }

const op = (port: string) => port.slice(port.lastIndexOf('/') + 1)
const row = (k: string, v: unknown) => html`<dt>${k}</dt><dd>${v}</dd>`
const link = (c: Ctx, id: string, label: string) => html`<a href="#" @click=${(e: Event) => { e.preventDefault(); c.go(id) }}>${label}</a>`
const list = (items: unknown[]) => items.length ? html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>` : html`<span class="muted">none</span>`
/** The runtimes `pod` is placed in. */
const placed = (d: AppDeployment, pod: string) => Object.keys(d.runtimes).filter(r => d.runtimes[r]!.pods.includes(pod))
const podLink = (c: Ctx, pod: string) => { const r = placed(c.d, pod)[0]; return r ? link(c, `p:${r}:${pod}`, pod) : pod }
type Pipe = Extract<Subscription, { kind: 'pipe' }>
/** A pipe, as `from.source → to.target`; `end` renders each pod (as text, unless given). */
const pipeText = (s: Pipe, end: (pod: string) => unknown = p => p) => html`${end(s.from)}.${op(s.source)} → ${end(s.to)}.${op(s.target)}`
/** The op at `port` (`<interface>/<op>`), with its interface's coord and its name; `o` none when not registered. */
const opAt = (c: Ctx, port: string) => {
  const at = port.lastIndexOf('/'), coord = port.slice(0, at), name = port.slice(at + 1)
  return { coord, name, o: Object.values(c.registry.interface(coord)?.ops ?? {}).find(x => x.name === name) }
}
/** One call, as `[from.]source → [to.]target`, flagged when not declared. */
const callRow = (c: Ctx, x: Called, from: boolean, to: boolean) => html`${from ? html`${podLink(c, x.from)}.` : nothing}${x.source === null ? '?' : op(x.source)} → ${to ? html`${podLink(c, x.to)}.` : nothing}${op(x.target)}${x.declared ? nothing : html` <span class="warn">not declared</span>`}`

function pod(c: Ctx, runtime: string, name: string) {
  const p = c.d.pods[name]
  if (!p) return html`<p class="muted">${name} is no longer deployed.</p>`
  const impl = c.registry.implementation(p.implementation)
  const subs = Object.entries(c.d.runtimes).flatMap(([r, rt]) => rt.subscriptions.map(s => ({ r, s })))
  const calls = subs.filter(({ s }) => s.kind === 'call' && s.from === name).map(({ s }) => s.to)
  const needs = Object.entries(impl?.dependencies ?? {}).map(([role, sel]) => {
    const to = calls.find(t => { const i = c.registry.implementation(c.d.pods[t]?.implementation ?? ''); return !sel.implements || i?.provides.some(x => x.coord === String(sel.implements)) })
    return html`${role} (${sel.implements ?? 'any'}) → ${to ? podLink(c, to) : html`<span class="warn">not connected</span>`}`
  })
  return html`<h3>pod ${name}</h3><dl>
    ${row('implementation', link(c, `m:${p.implementation}`, p.implementation))}
    ${row('runtimes', placed(c.d, name).map((r, i) => html`${i ? ', ' : ''}${link(c, `r:${r}`, r)}`))}
    ${row('isolation', p.isolation ?? 'host')}${row('starts', p.eager ? 'eager' : 'lazy')}${row('state', c.status(placed(c.d, name)[0] ?? '', name))}
    ${row('config', p.config === undefined ? html`<span class="muted">none</span>` : html`<code>${JSON.stringify(p.config)}</code>`)}
    ${row('needs', list(needs))}
    ${c.calls ? row('calls', list(c.calls.filter(x => x.from === name).map(x => callRow(c, x, false, true)))) : nothing}
    ${row('called by', c.calls?.some(x => x.to === name) ? list(c.calls.filter(x => x.to === name).map(x => callRow(c, x, true, false)))
      : list(subs.filter(({ s }) => s.kind === 'call' && s.to === name).map(({ s }) => podLink(c, s.from))))}
    ${row('pipes', list(subs.flatMap(({ s }) => s.kind === 'pipe' && (s.from === name || s.to === name) ? [pipeText(s)] : [])))}
  </dl><button class="btn" @click=${() => c.open({ runtime, pod: name })}>Open view</button>`
}

function runtime(c: Ctx, id: string) {
  const r = c.d.runtimes[id]
  if (!r) return html`<p class="muted">${id} is no longer deployed.</p>`
  return html`<h3>runtime ${id}</h3><dl>
    ${row('pods', list(r.pods.map(p => link(c, `p:${id}:${p}`, p))))}
    ${row('call edges', list(r.subscriptions.flatMap(s => s.kind === 'call' ? [html`${podLink(c, s.from)} → ${podLink(c, s.to)}`] : [])))}
    ${row('pipes', list(r.subscriptions.flatMap(s => s.kind === 'pipe' ? [pipeText(s)] : [])))}
    ${row('policy', !r.policy ? 'none (everything allowed)' : r.policy.kind === 'rules' ? `${r.policy.rules.length} rules (see Settings)` : r.policy.kind)}
  </dl><button class="btn" @click=${() => c.remove(id)}>Delete runtime</button>`
}

type Shape = { type?: string; properties?: Record<string, unknown>; items?: Shape; anyOf?: Shape[]; const?: unknown }
/** A schema in a few characters: its label, else its shape (`{ a, b }`, `string[]`, `a | b`). */
export const typeName = (def: (Shape & { label?: string }) | undefined): string => {
  if (!def) return 'nothing'
  if (def.label) return def.label
  if (def.anyOf) return def.anyOf.map(typeName).join(' | ')
  if (def.const !== undefined) return JSON.stringify(def.const)
  if (def.type === 'object') { const k = Object.keys(def.properties ?? {}); return `{ ${k.slice(0, 4).join(', ')}${k.length > 4 ? ', …' : ''} }` }
  if (def.type === 'array') return `${typeName(def.items)}[]`
  return def.type ?? 'any'
}

/** An Op by its port (`<interface>/<op>`): a link to its interface, its kind, and its type: what a source emits
 * (an event's value, an action's result), what a target takes. */
function opRow(c: Ctx, port: string, side: 'source' | 'target') {
  const { coord, name, o } = opAt(c, port)
  const type = o && (side === 'source' ? o.output : o.input)
  return html`${link(c, `i:${coord}`, coord)}/<code>${name}</code>${o ? html` <span class="muted">${o.kind}, ${side === 'source' ? 'emits' : 'takes'}</span> <code>${typeName(type as Shape)}</code>` : nothing}`
}

function subscription(c: Ctx, runtime: string, pod: string, i: number) {
  const s = c.d.runtimes[runtime]?.subscriptions.filter(x => x.from === pod)[i]
  if (!s) return html`<p class="muted">That subscription is no longer deployed.</p>`
  return html`<h3>${s.kind === 'call' ? 'call edge' : 'pipe'}</h3><dl>
    ${row('runtime', link(c, `r:${runtime}`, runtime))}${row('from', podLink(c, s.from))}${row('to', podLink(c, s.to))}
    ${s.kind === 'pipe' ? html`${row('source', opRow(c, s.source, 'source'))}${row('target', opRow(c, s.target, 'target'))}` : nothing}
  </dl>${s.kind === 'call' ? html`<button class="btn" @click=${() => c.open({ runtime: placed(c.d, s.to)[0] ?? runtime, pod: s.to })}>Open ${s.to}</button>` : nothing}`
}

function iface(c: Ctx, coord: string) {
  const i = c.registry.manifest().interfaces.find(x => x.coord === coord)
  if (!i) return html`<p class="muted">${coord} is not registered.</p>`
  return html`<h3>interface ${coord}</h3><dl>
    ${row('ops', list(i.ops.map(({ name, kind }) => {
      const { o } = opAt(c, `${coord}/${name}`), out = html`<code>${typeName(o?.output as Shape)}</code>`
      const shape = kind === 'event' ? html`emits ${out}` : html`<code>${typeName(o?.input as Shape)}</code> → ${out}`
      return html`${link(c, `o:${coord}/${name}`, name)} ${kind} <span class="muted">${shape}</span>`
    })))}
    ${row('implementations', list(c.registry.implementationsOf(coord).map(m => link(c, `m:${m.coord}`, m.coord))))}
  </dl>`
}

function implementation(c: Ctx, coord: string) {
  const m = c.registry.implementation(coord)
  if (!m) return html`<p class="muted">${coord} is not registered.</p>`
  return html`<h3>implementation ${coord}</h3>${m.description ? html`<p>${m.description}</p>` : nothing}<dl>
    ${row('provider', m.provider)}
    ${row('provides', list(m.provides.map(i => link(c, `i:${i.coord}`, i.coord))))}
    ${row('needs', list(Object.entries(m.dependencies).map(([role, s]) => html`${role}: ${s.implements ? link(c, `i:${s.implements}`, String(s.implements)) : JSON.stringify(s)}`)))}
    ${row('pods', list(Object.entries(c.d.pods).filter(([, p]) => p.implementation === coord).map(([n]) => podLink(c, n))))}
  </dl>`
}

function operation(c: Ctx, port: string) {
  const { coord, name, o } = opAt(c, port)
  if (!o) return html`<p class="muted">${port} is not registered.</p>`
  const impls = c.registry.implementationsOf(coord).map(m => m.coord)
  const subs = Object.values(c.d.runtimes).flatMap(r => r.subscriptions)
  const pipes = subs.flatMap(s => s.kind === 'pipe' && (s.source === port || s.target === port) ? [pipeText(s, p => podLink(c, p))] : [])
  return html`<h3>${o.kind} ${name}</h3>${o.description ? html`<p>${o.description}</p>` : nothing}<dl>
    ${row('interface', link(c, `i:${coord}`, coord))}
    ${o.kind === 'event' ? row('emits', html`<code>${typeName(o.output as Shape)}</code>`) : html`${row('takes', html`<code>${typeName(o.input as Shape)}</code>`)}${row('returns', html`<code>${typeName(o.output as Shape)}</code>`)}`}
    ${row('implementations', list(impls.map(m => link(c, `m:${m}`, m))))}
    ${row('pods', list(Object.keys(c.d.pods).filter(p => impls.includes(c.d.pods[p]!.implementation)).map(p => podLink(c, p))))}
    ${row('pipes', list(pipes))}
    ${c.calls ? html`${row('called by', list(c.calls.filter(x => x.target === port).map(x => callRow(c, x, true, true))))}${row('calls', list(c.calls.filter(x => x.source === port).map(x => callRow(c, x, true, true))))}` : nothing}
  </dl>`
}

/** The details of node `id`, or a hint when nothing is selected. */
export function details(c: Ctx, id: string | null): TemplateResult {
  if (!id) return html`<p class="muted">Select a runtime, pod, subscription, interface, implementation or operation.</p>`
  const [kind, ...rest] = id.split(':'), at = rest.join(':')
  if (kind === 'r') return runtime(c, at)
  if (kind === 'p') return pod(c, rest[0]!, rest.slice(1).join(':'))
  if (kind === 's') return subscription(c, rest[0]!, rest[1]!, Number(rest[2]))
  if (kind === 'i') return iface(c, at)
  if (kind === 'm') return implementation(c, at)
  if (kind === 'o') return operation(c, at)
  return html``
}
