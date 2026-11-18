// The rack's 3D store blocks.
import { html } from 'lit'
import { clamp } from './constants'
import type { Vals } from './render-root'

/** Rack components with no out jack, as the prototype's 3D store boxes; they show more the further the pane turns. */
export function renderBlocks(d: Vals) {
  const { s, m, selId, selRoute, backness } = d
  const blockOp = clamp((backness + 0.3) / 0.55, 0, 1).toFixed(3)
  const recent = (at?: number) => at !== undefined && d.now - at < 320
  return m.rack.filter(r => r.block).map(r => {
    const touches = m.wires.some(w => w.route === selId && (m.P[w.from]!.owner === r.id || m.P[w.to]!.owner === r.id))
    const st = s.stats[r.id] ?? { in: 0, out: 0 }
    const face = recent(s.hits[r.id]) ? '#33404F' : '#252D39'
    const edge = r.id === s.selMod ? '#E6EDF3' : selId === null ? (recent(s.hits[r.id]) ? '#E6EDF3' : '#4A5564') : touches ? selRoute!.color : '#2F3845'
    const bd = 64
    return html`<div data-block=${r.id} data-deploy=${r.deploy} style="position:absolute; left:${r.x}px; top:${r.y}px; width:${r.w}px; height:82px; transform-style:preserve-3d; pointer-events:none">
  <div style="position:absolute; left:0; top:0; width:${r.w}px; height:${bd}px; background:#36404E; transform-origin:50% 0; transform:rotateX(90deg); opacity:${blockOp}"></div>
  <div style="position:absolute; left:0; top:82px; width:${r.w}px; height:${bd}px; background:#10141A; transform-origin:50% 0; transform:rotateX(90deg); opacity:${blockOp}"></div>
  <div style="position:absolute; left:0; top:0; width:${bd}px; height:82px; background:#1A2029; transform-origin:0 50%; transform:rotateY(-90deg); opacity:${blockOp}"></div>
  <div style="position:absolute; left:${r.w}px; top:0; width:${bd}px; height:82px; background:#1A2029; transform-origin:0 50%; transform:rotateY(-90deg); opacity:${blockOp}"></div>
  <div style="position:absolute; left:0; top:0; width:${r.w}px; height:82px; box-sizing:border-box; background:${face}; border:1px solid ${edge}; border-radius:3px; transform:translateZ(${bd}px); opacity:${blockOp}; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#E6EDF3" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2"></rect><path d="M8 8h8M8 12h8M8 16h5"></path></svg>
    <span style="font-size:11px; font-weight:600; color:#E6EDF3">${r.title}</span>
    <span class="mono" style="font-size:9.5px; color:#A3AEBC">${r.sub + ' · ' + st.in + ' entries'}</span>
  </div>
</div>`
  })
}
