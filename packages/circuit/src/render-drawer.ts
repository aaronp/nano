// The details drawer: what is selected, read-only. Kicker, title, sub line, type chips, rows and the schema as JSON.
import { html, nothing } from 'lit'
import type { Circuit } from './circuit'
import { TYPE_COLOR, TYPE_GLYPH, TYPE_NAME } from './constants'
import type { Footprint, Pad, PadType, SideItem } from './types'

type View = { kicker: string; title: string; sub: string; types: PadType[]; rows: [string, string][]; schemaLabel?: string; schema?: unknown; follow: boolean }

const uniq = <T,>(xs: T[]) => [...new Set(xs)]

/** Resolves the selection (`pad:`, `cable:`, `fp:` or `cover:`) to what the drawer shows. */
export function describe(el: Circuit): View | null {
  const { sel } = el.s, m = el.model
  if (!sel) return null
  const [what, id = ''] = [sel.slice(0, sel.indexOf(':')), sel.slice(sel.indexOf(':') + 1)]
  const items: (Footprint | SideItem)[] = [...m.layers.flatMap(l => l.footprints), ...m.side.flatMap(b => b.items)]
  const pads = items.flatMap(i => i.pads), padOf = (key: string) => pads.find(p => p.key === key)
  const routes = (p: Pad) => m.cables.filter(c => c.from.pad === p.key || c.to.pad === p.key).length
  const name = (p: Pad) => `${p.instance}.${p.label}`
  if (what === 'pad') {
    const p = padOf(id)
    if (!p) return null
    return { kicker: `${p.dir === 'in' ? 'Input' : 'Output'} pad`, title: name(p), sub: p.op, types: [p.type],
      rows: [['Kind', p.kind], ['Type', TYPE_NAME[p.type]], ['Routes', String(routes(p))], ['Description', p.description ?? '-']],
      schemaLabel: p.dir === 'in' ? 'Input schema' : 'Output schema', schema: p.schema, follow: routes(p) > 0 }
  }
  if (what === 'cable') {
    const c = m.cables.find(x => x.id === id), a = c && padOf(c.from.pad), b = c && padOf(c.to.pad)
    if (!c || !a || !b) return null
    return { kicker: 'Cable', title: `${name(a)} → ${name(b)}`, sub: c.system, types: [c.type],
      rows: [['Kind', a.kind], ['Type', TYPE_NAME[c.type]], ['From', name(a)], ['To', name(b)]], schemaLabel: 'Output schema', schema: a.schema, follow: true }
  }
  const inst = what === 'cover' ? id.slice(id.indexOf('|') + 1) : id
  const it = items.find(i => `${i.system}/${i.instance}` === inst || i.instance === inst)
  if (!it) return null
  return { kicker: 'kind' in it && it.kind ? it.kind : 'Component', title: it.title, sub: `${it.system}/${it.instance}`, types: uniq(it.pads.map(p => p.type)),
    rows: [['Kind', it.kind ?? '-'], ['Pads', String(it.pads.length)], ['Routes', String(it.pads.reduce((n, p) => n + routes(p), 0))]], follow: false }
}

export function renderDrawer(el: Circuit) {
  const d = describe(el)
  return html`<aside class="drawer" aria-label="Details" ?hidden=${!d} @wheel=${(e: Event) => e.stopPropagation()}>${!d ? nothing : html`
    <div class="d-head"><div><div class="kicker">${d.kicker}</div><div class="d-title">${d.title}</div><div class="d-sub">${d.sub}</div></div>
      <button aria-label="Close details" @click=${() => { el.select(null); el.refocus() }}>✕</button></div>
    <div class="chips">${d.types.map(t => html`<span class="chip"><span class="glyph" aria-hidden="true" style="background:${TYPE_COLOR[t]}">${TYPE_GLYPH[t]}</span>${TYPE_NAME[t]}</span>`)}</div>
    <dl>${d.rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
    ${d.schemaLabel ? html`<div class="kicker">${d.schemaLabel}</div><pre>${d.schema === undefined ? 'none (signal)' : JSON.stringify(d.schema, null, 2)}</pre>` : nothing}
    ${d.follow ? html`<div class="actions"><button @click=${() => el.follow()}>Follow cable</button></div>` : nothing}`}</aside>`
}
