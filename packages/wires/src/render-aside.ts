// The right-hand panel: View, the mode toggle and wiring edit, the Operators palette (the host's catalog), Routes
// and the Legend.
import { html } from 'lit'
import { ASIDE_W, HEADER_H, OK_COLOR, fade } from './constants'
import { pickOperator, removeSel, toggleEdit } from './pointer'
import { inFlight } from './render-back'
import type { Vals } from './render-root'
import type { Wires } from './wires'

const h2 = (text: string) => html`<h2 style="margin:0; font-size:11px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:#8B96A5">${text}</h2>`
const viewBtn = (label: string, go: () => void) => html`<button type="button" class="sidebtn" @click=${go} style="height:44px; border-radius:6px; border:1px solid #2F3845; background:#161B22; color:#E6EDF3; font:inherit; font-size:12px; cursor:pointer">${label}</button>`
const seg = (label: string, on: boolean, pick: () => void) => html`<button type="button" class="seg" aria-pressed=${on ? 'true' : 'false'} @click=${pick} style="height:40px; border-radius:5px; border:0; background:${on ? '#E6EDF3' : 'transparent'}; color:${on ? '#12161C' : '#C9D1D9'}; font:inherit; font-size:12px; font-weight:600; cursor:pointer">${label}</button>`

export function renderAside(el: Wires, d: Vals) {
  const { s, m, isRelay, selId } = d
  const editing = s.editing
  const editFg = editing ? '#12161C' : '#E6EDF3'
  const flying = inFlight(el, d)
  const selModule = s.selMod !== null ? m.rack.find(r => r.id === s.selMod) ?? null : null
  const selStat = selModule ? s.stats[selModule.id] ?? { in: 0, out: 0 } : null
  const routes = m.routes.map(r => {
    const n = flying.filter(p => p.w.route === r.id).length
    const on = selId === r.id
    return { ...r, on, chain: el.puzzle.descs[r.id] ?? '', inFlight: n === 0 ? '' : n + ' in flight' }
  })
  return html`<aside style="position:absolute; right:0; top:${HEADER_H}px; bottom:0; ${fade(d.shown)}; width:${ASIDE_W}px; box-sizing:border-box; padding:22px 22px 24px; border-left:1px solid #1F252E; background:#0F1318; display:flex; flex-direction:column; gap:22px; overflow-y:auto">

  <section style="display:flex; flex-direction:column; gap:10px">
    ${h2('View')}
    <div style="display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:6px">
      ${viewBtn('Front', () => el.goTo('front'))}${viewBtn('Angled', () => el.goTo('angled'))}${viewBtn('Back', () => el.goTo('back'))}${viewBtn('Below', () => el.goTo('under'))}
    </div>
    <button type="button" class="sidebtn" @click=${() => el.setState({ ry: s.ry + 180, dragging: false, editing: false, cord: null, armed: null })} style="height:44px; border-radius:6px; border:0; background:#E6EDF3; color:#12161C; font:inherit; font-size:13px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#12161C" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"></path><path d="M21 3v5h-5"></path></svg>
      Flip pane
    </button>
  </section>

  <section style="display:flex; flex-direction:column; gap:10px">
    ${h2('Behind the pane')}
    <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:4px; padding:4px; border-radius:8px; background:#161B22; border:1px solid #262D38">
      ${seg('Relay wires', isRelay, () => el.setState({ mode: 'relay', armed: null, cord: null }))}${seg('Puzzle blocks', !isRelay, () => el.setState({ mode: 'puzzle', cord: null }))}
    </div>
    <button type="button" class="sidebtn" aria-pressed=${editing ? 'true' : 'false'} @click=${() => toggleEdit(el)} style="height:44px; border-radius:6px; border:1px solid ${editing ? OK_COLOR : '#2F3845'}; background:${editing ? OK_COLOR : '#161B22'}; color:${editFg}; font:inherit; font-size:13px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke=${editFg} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v5M17 3v5M5 8h14v3a7 7 0 0 1-14 0z"></path><path d="M12 18v3"></path></svg>
      ${editing ? 'Done editing' : 'Edit wiring'}
    </button>
    ${isRelay ? '' : html`<label style="display:flex; flex-direction:column; gap:6px; font-size:12px; color:#C9D1D9">
      <span style="display:flex; justify-content:space-between">Float height <span class="mono" style="color:#8B96A5">${s.depth} px</span></span>
      <input type="range" min="0" max="140" step="2" .value=${String(s.depth)} @input=${(e: Event) => el.setState({ depth: Number((e.target as HTMLInputElement).value) })} style="accent-color:#E6EDF3">
    </label>`}
    <p style="margin:0; font-size:12px; line-height:1.5; color:#8B96A5">${isRelay
      ? 'Each panel has jacks on its back. Events travel as packets along the patch cords, through operator modules in the service rack; each module counts events in and out.'
      : 'Each route is a chain of interlocking pieces built from the same wiring. Packets hop from piece to piece; extra inputs arrive along the dashed leaders.'}</p>
  </section>

  ${editing ? html`<section style="display:flex; flex-direction:column; gap:10px">
    ${h2('Operators')}
    <p style="margin:0; font-size:12px; line-height:1.5; color:#8B96A5">${isRelay
      ? 'Click to drop an operator into the rack, then patch it in with cords. It starts processing live events as soon as it is wired.'
      : 'Pick one, then click a + between two pieces to splice it into that chain while it runs.'}</p>
    <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:6px">
      ${Object.entries(el.catalog).map(([kind, c]) => {
        const on = s.armed === kind
        return html`<button type="button" class="sidebtn" aria-pressed=${on ? 'true' : 'false'} data-kind=${kind} @click=${() => pickOperator(el, kind)} style="min-height:44px; padding:6px 10px; border-radius:6px; border:1px solid ${on ? '#E6EDF3' : '#2F3845'}; background:${on ? '#E6EDF3' : '#161B22'}; color:${on ? '#12161C' : '#E6EDF3'}; font:inherit; text-align:left; cursor:pointer; display:flex; flex-direction:column; gap:1px">
          <span style="font-size:12px; font-weight:600">${c.title}</span>
          <span class="mono" style="font-size:10px; color:${on ? '#2A2F37' : '#8B96A5'}">${kind}</span>
        </button>`
      })}
    </div>
    ${selModule ? html`<div style="display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; border:1px solid #E6EDF3; background:#161B22">
      <div style="flex:1; display:flex; flex-direction:column; gap:2px; min-width:0">
        <span style="font-size:13px; font-weight:600">${selModule.title}</span>
        <span class="mono" style="font-size:10.5px; color:#A3AEBC">${selModule.sub + ' · in ' + selStat!.in + ' · out ' + selStat!.out}</span>
      </div>
      <button type="button" class="sidebtn" @click=${() => removeSel(el)} style="height:36px; padding:0 12px; border-radius:6px; border:1px solid #FF7B72; background:transparent; color:#FF7B72; font:inherit; font-size:12px; font-weight:600; cursor:pointer">Remove</button>
    </div>` : ''}
  </section>` : ''}

  <section style="display:flex; flex-direction:column; gap:8px">
    <div style="display:flex; align-items:center; justify-content:space-between">
      ${h2('Routes')}
      <button type="button" class="sidebtn" @click=${() => el.setState({ sel: null })} style="min-height:28px; padding:0 8px; border-radius:4px; border:0; background:transparent; color:#8B96A5; font:inherit; font-size:12px; cursor:pointer">Show all</button>
    </div>
    ${routes.map(r => html`<button type="button" class="route" aria-pressed=${r.on ? 'true' : 'false'} @click=${() => el.setState({ sel: r.on ? null : r.id })} style="text-align:left; padding:10px 12px; border-radius:8px; border:1px solid ${r.on ? r.color : '#262D38'}; background:${r.on ? '#1B212A' : '#161B22'}; color:#E6EDF3; font:inherit; cursor:pointer; display:flex; flex-direction:column; gap:6px; opacity:${selId === null || r.on ? 1 : 0.6}">
      <span style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600"><span style="width:10px; height:10px; border-radius:2px; background:${r.color}"></span>${r.name}<span class="mono" style="margin-left:auto; font-size:10.5px; font-weight:500; color:#8B96A5">${r.inFlight}</span></span>
      <span class="mono" style="font-size:10.5px; line-height:1.55; color:#A3AEBC">${r.chain}</span>
    </button>`)}
  </section>

  <section style="display:flex; flex-direction:column; gap:10px">
    ${h2('Legend')}
    <div style="display:flex; flex-direction:column; gap:8px; font-size:12px; color:#C9D1D9">
      <span style="display:flex; align-items:center; gap:10px"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7.5" fill="#0A0D11" stroke="#4A5564" stroke-width="2"></circle><circle cx="9" cy="9" r="4" fill="#E6EDF3"></circle></svg>Emits an event (source)</span>
      <span style="display:flex; align-items:center; gap:10px"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7.5" fill="#0A0D11" stroke="#4A5564" stroke-width="2"></circle><circle cx="9" cy="9" r="2.5" fill="#4A5564"></circle></svg>Accepts an action (sink)</span>
      <span style="display:flex; align-items:center; gap:10px"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="#FFFFFF" stroke="#7EE787" stroke-width="3"></circle></svg>An event in flight (packet)</span>
      <span style="display:flex; align-items:center; gap:10px"><span class="mono" style="font-size:10px; padding:1px 5px; border-radius:3px; background:#0A0D11; color:#7EE787; border:1px solid #262D38">12→2</span>Operator events in → out</span>
      <span style="display:flex; align-items:center; gap:10px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C9D1D9" stroke-width="1.6" aria-hidden="true"><path d="M4 8l8-4 8 4v8l-8 4-8-4z"></path><path d="M4 8l8 4 8-4M12 12v8"></path></svg>Non-visual service (3D block)</span>
    </div>
  </section>
</aside>`
}
