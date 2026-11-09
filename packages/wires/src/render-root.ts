// The root: unflipped, just the slotted dock; flipped, the prototype's header, stage and aside around it.
import { html } from 'lit'
import { HEADER_H, OK_COLOR, fade } from './constants'
import type { Route } from './model'
import { renderAside } from './render-aside'
import { renderStage } from './render-stage'
import type { Wires } from './wires'

/** What every part of the template reads: the prototype's shared renderVals locals. */
export function derive(el: Wires) {
  const { s, model: m, puzzle } = el
  const isRelay = s.mode === 'relay'
  const rad = Math.PI / 180
  const backness = -Math.cos(s.ry * rad) * Math.cos(s.rx * rad)
  const selRoute = m.routes.find(r => r.id === s.sel) ?? null
  const selId = selRoute ? selRoute.id : null
  const opFor = (routeId: string | null) => (selId === null || selId === routeId ? 1 : 0.13)
  const routeById = (id: string): Route => m.routes.find(r => r.id === id) ?? { id, name: id, color: '#E6EDF3' }
  /** The route a component is on, if any. */
  const routeOfOwner = (id: string) => m.wires.find(w => m.P[w.from]!.owner === id || m.P[w.to]!.owner === id)?.route ?? null
  const shown = !s.entering && !s.leaving
  return { s, m, puzzle, isRelay, shown, backness, selRoute, selId, opFor, routeById, routeOfOwner, now: el.now() }
}
export type Vals = ReturnType<typeof derive>

const norm = (a: number) => Math.round((((a % 360) + 540) % 360) - 180)

export function renderRoot(el: Wires) {
  if (!el.flipped) return html`<slot></slot>`
  const d = derive(el)
  const { s, m, backness } = d
  const facing = s.editing ? 'Editing · back' : backness > 0.25 ? 'Back · wiring' : backness < -0.25 ? 'Front · UI' : 'Edge-on'
  const facingColor = s.editing ? OK_COLOR : backness > 0.25 ? '#F5A524' : '#C9D1D9'
  const ops = m.rack.filter(r => !r.block).length, services = m.rack.length - ops
  const summary = 'Workspace pane · ' + m.chassis.length + ' panels · ' + services + ' services · ' + ops + ' operators · ' + m.routes.length + ' routes'
  return html`<div style="width:100%; height:100%; background:#0B0E12; color:#E6EDF3; font-family:Inter,system-ui,sans-serif; position:relative; overflow:hidden">
  <header style="position:absolute; left:0; right:0; top:0; z-index:1; ${fade(d.shown)}; height:${HEADER_H}px; box-sizing:border-box; display:flex; align-items:center; gap:16px; padding:0 24px; border-bottom:1px solid #1F252E; background:#0F1318">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F5A524" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="7" rx="1.5"></rect><rect x="14" y="13" width="7" height="7" rx="1.5"></rect><path d="M10 7.5h3a2 2 0 0 1 2 2V13"></path></svg>
    <div style="display:flex; flex-direction:column; gap:2px">
      <h1 style="margin:0; font-size:16px; font-weight:600; letter-spacing:-0.01em">Workspace wiring</h1>
      <p style="margin:0; font-size:12px; color:#8B96A5">${summary}</p>
    </div>
    <div style="flex:1"></div>
    <span class="mono" style="display:flex; align-items:center; gap:8px; font-size:12px; color:${OK_COLOR}"><span style="width:8px; height:8px; border-radius:50%; background:${OK_COLOR}"></span>LIVE</span>
    <p class="mono" style="margin:0; font-size:12px; color:#8B96A5">${'yaw ' + norm(s.ry) + '°  pitch ' + norm(s.rx) + '°'}</p>
    <span style="font-size:12px; font-weight:600; padding:6px 10px; border-radius:999px; border:1px solid ${s.editing ? OK_COLOR : '#2F3845'}; color:${facingColor}">${facing}</span>
    <button type="button" class="sidebtn" aria-label="Back to the workspace" @click=${() => el.close()} style="height:36px; padding:0 12px; border-radius:6px; border:1px solid #2F3845; background:#161B22; color:#E6EDF3; font:inherit; font-size:12px; cursor:pointer">Done</button>
  </header>
  ${renderStage(el, d)}${renderAside(el, d)}
</div>`
}
