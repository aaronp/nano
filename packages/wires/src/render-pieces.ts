// Puzzle mode's floating layer (stalks, interlocking pieces, joints, packets) and the rack's 3D store blocks.
import { html, svg } from 'lit'
import { PIECE_H, TAB_R, clamp } from './constants'
import { piecePath, polylineAt } from './geometry'
import { joint } from './pointer'
import { pieceColors } from './puzzle'
import { inFlight } from './render-back'
import type { Vals } from './render-root'
import type { Wires } from './wires'

export function renderPuzzle(el: Wires, d: Vals) {
  const { s, m, opFor, routeById } = d
  const { W, H } = m
  const armed = s.armed ? el.catalog[s.armed]?.title ?? s.armed : null
  const pieces = el.puzzle.pieces.map(p => {
    const c = pieceColors(p.kind, routeById(p.route).color)
    const isSel = p.moduleId !== null && p.moduleId === s.selMod
    const hot = p.owner !== null && (el.recent(s.hits[p.owner]) || (p.kind === 'port' && el.recent(s.flashes[p.owner])))
    const st = p.moduleId ? s.stats[p.moduleId] ?? { in: 0, out: 0 } : null
    return {
      ...c, p, svgW: p.w + TAB_R + 2, d: piecePath(p.w, p.h, p.tabs, p.notch), padL: p.notch ? 16 : 12, op: opFor(p.route),
      stroke: isSel || hot ? '#FFFFFF' : c.stroke, strokeW: isSel ? 3 : hot ? 2.5 : 1.5,
      stat: st ? st.in + '→' + st.out : '', statOp: st ? 1 : 0,
      selectable: s.editing && p.moduleId !== null, pressed: isSel ? 'true' : 'false',
      pick: () => el.setState({ selMod: isSel ? null : p.moduleId }),
      hasJoint: s.editing && p.inWire !== null,
      jointLabel: armed !== null ? 'Insert ' + armed + ' before ' + p.title : 'Unplug the cord into ' + p.title,
    }
  })
  const stalks = el.puzzle.pieces.filter(p => p.anchors.length).map(p => {
    const op = opFor(p.route)
    return { x: Math.round(p.x + p.w / 2), y: Math.round(p.y + PIECE_H / 2) - 1, color: routeById(p.route).color, op: op === 1 ? 0.9 : 0.1 }
  })
  const piecePackets = inFlight(el, d).filter(p => el.puzzle.segs[p.wire]?.layer === 'piece').map(p => {
    const [x, y] = polylineAt(el.puzzle.segs[p.wire]!.pts, p.f)
    return { ...p, x: x!, y: y! }
  })
  return html`<div style="position:absolute; left:0; top:0; width:${W}px; height:${H}px; transform-style:preserve-3d; pointer-events:none">
  ${stalks.map(t => html`<div style="position:absolute; left:${t.x}px; top:${t.y}px; width:${s.depth}px; height:2px; background:${t.color}; opacity:${t.op}; transform-origin:0 50%; transform:rotateY(-90deg)"></div>`)}
</div>
<div style="position:absolute; left:0; top:0; width:${W}px; height:${H}px; transform:translateZ(${s.depth}px); backface-visibility:hidden; -webkit-backface-visibility:hidden; pointer-events:${s.editing ? 'auto' : 'none'}">
  ${pieces.map(x => html`<div data-piece=${x.p.label} style="position:absolute; left:${x.p.x}px; top:${x.p.y}px; width:${x.p.w}px; height:${x.p.h}px; opacity:${x.op}">
    <svg width=${x.svgW} height=${x.p.h} style="position:absolute; left:0; top:0; overflow:visible" aria-hidden="true">
      <path d=${x.d} fill=${x.fill} stroke=${x.stroke} stroke-width=${x.strokeW} stroke-linejoin="round"></path>
    </svg>
    <div style="position:absolute; left:${x.padL}px; top:0; height:40px; display:flex; flex-direction:column; justify-content:center; gap:1px; pointer-events:none">
      <span style="font-size:11.5px; font-weight:700; color:${x.titleColor}; white-space:nowrap">${x.p.title}</span>
      <span class="mono" style="font-size:10px; color:${x.subColor}; white-space:nowrap">${x.p.sub}</span>
    </div>
    <span class="mono" style="position:absolute; left:10px; top:-17px; font-size:9.5px; padding:1px 5px; border-radius:3px; background:#0A0D11; color:#7EE787; white-space:nowrap; opacity:${x.statOp}; pointer-events:none">${x.stat}</span>
    ${x.selectable ? html`<button type="button" class="piecebtn" aria-label=${'Select ' + x.p.title} aria-pressed=${x.pressed} @click=${x.pick} style="position:absolute; left:0; top:0; width:100%; height:40px; padding:0; border:0; background:transparent; cursor:pointer"></button>` : ''}
    ${x.hasJoint ? html`<button type="button" class="joint" aria-label=${x.jointLabel} @click=${() => joint(el, x.p.inWire!)} style="position:absolute; left:-12px; top:8px; width:24px; height:24px; padding:0; border-radius:50%; border:2px solid #0A0D11; background:#E6EDF3; color:#12161C; font:700 16px/1 Inter, sans-serif; cursor:pointer; display:flex; align-items:center; justify-content:center">${armed !== null ? '+' : '×'}</button>` : ''}
  </div>`)}
  <svg width=${W} height=${H} style="position:absolute; left:0; top:0; overflow:visible; pointer-events:none" aria-hidden="true">
    ${piecePackets.map(k => svg`<g opacity=${k.op}>
      <circle cx=${k.x.toFixed(1)} cy=${k.y.toFixed(1)} r="6" fill="#FFFFFF" stroke="#0A0D11" stroke-width="2"></circle>
      <circle cx=${k.x.toFixed(1)} cy=${k.y.toFixed(1)} r="2.5" fill=${k.color}></circle>
      <text class="pkt-label" x=${(k.x + 9).toFixed(1)} y=${(k.y - 9).toFixed(1)} font-family="JetBrains Mono, monospace" font-size="10" font-weight="600" fill="#FFFFFF">${k.label}</text>
    </g>`)}
  </svg>
</div>`
}

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
    return html`<div data-block=${r.id} style="position:absolute; left:${r.x}px; top:${r.y}px; width:${r.w}px; height:82px; transform-style:preserve-3d; pointer-events:none">
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
