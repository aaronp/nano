// The back plate: panel chassis, the service rack and its modules, jacks, cords, packets, the live cord, and (in
// puzzle mode) the dashed leaders and their packets.
import { html, svg } from 'lit'
import { ERR_COLOR, OK_COLOR, TRAVEL_MS, clamp } from './constants'
import { bezierAt, cordD, cordGeo, polylineAt } from './geometry'
import { checkConnect } from './model'
import { visibleKeys } from './pointer'
import type { Vals } from './render-root'
import type { Wires } from './wires'

/** Packets in flight on drawn wires, with how far along they are. */
export const inFlight = (el: Wires, d: Vals) => d.s.packets
  .filter(p => d.m.wires.some(w => w.id === p.wire))
  .map(p => {
    const w = d.m.wires.find(x => x.id === p.wire)!
    return { ...p, w, f: clamp((d.now - p.born) / TRAVEL_MS, 0, 1), color: d.routeById(w.route).color, op: d.opFor(w.route) }
  })

/** A packet dot with its value. */
export const packet = (k: { x: number; y: number; color: string; op: number; label: string }, r: number, sw: number, dx: number) => svg`<g opacity=${k.op}>
  <circle cx=${k.x.toFixed(1)} cy=${k.y.toFixed(1)} r=${r} fill="#FFFFFF" stroke=${k.color} stroke-width=${sw}></circle>
  <text class="pkt-label" x=${(k.x + dx).toFixed(1)} y=${(k.y - 9).toFixed(1)} font-family="JetBrains Mono, monospace" font-size="10.5" font-weight="600" fill="#FFFFFF">${k.label}</text>
</g>`

export function renderBack(el: Wires, d: Vals) {
  const { s, m, isRelay, selId, selRoute, opFor, routeById, routeOfOwner } = d
  const { W, H, P } = m
  const cord = s.cord
  // a cord being moved is drawn live, not in its old place, and doesn't count when checking a drop
  const wires = m.wires.filter(w => w.id !== cord?.picked)
  const base = { ...m, wires }
  const lit = (k: string) => cord !== null && !('error' in checkConnect(base, cord.anchor, k))

  const chassis = m.chassis.map(c => {
    const onSel = selRoute !== null && c.instance !== null && wires.some(w => w.route === selId && (P[w.from]!.owner === c.instance || P[w.to]!.owner === c.instance))
    const hot = c.instance !== null && (el.recent(s.flashes[c.instance]) || el.recent(s.hits[c.instance]))
    return { ...c, border: onSel ? selRoute!.color : hot ? '#E6EDF3' : '#3A4554' }
  })

  const jackRoute: Record<string, string> = {}
  wires.forEach(w => { jackRoute[w.from] ??= w.route; jackRoute[w.to] ??= w.route })
  const jacks = visibleKeys(el).map(k => {
    const p = P[k]!
    const isHover = cord !== null && k === cord.hover
    const isAnchor = cord !== null && k === cord.anchor
    const ring = isHover ? (cord.err ? ERR_COLOR : OK_COLOR) : isAnchor ? '#E6EDF3' : lit(k) ? OK_COLOR : '#4A5564'
    const base = {
      x: p.x, y: p.y, label: p.label, ring, ringR: isHover ? 12 : 9,
      core: p.dir === 'out' ? '#E6EDF3' : '#4A5564', coreR: p.dir === 'in' ? 3 : 4.5,
      op: cord !== null ? (isAnchor || lit(k) ? 1 : 0.3) : selId === null || jackRoute[k] === selId ? 1 : 0.3,
    }
    if (p.kind === 'chassis') return { ...base, lx: p.x + 14, ly: p.y + 4, anchor: 'start' }
    if (p.kind === 'block') return { ...base, lx: p.x, ly: p.y - 14, anchor: 'middle' }
    return { ...base, lx: p.x, ly: p.y + 21, anchor: 'middle' }
  })

  const cords = wires.map(w => {
    const gm = cordGeo(P[w.from]!, P[w.to]!)
    return { id: w.id, gm, d: cordD(gm), color: routeById(w.route).color, op: opFor(w.route), sel: selId === w.route }
  })
  const flying = inFlight(el, d)
  const relayPackets = isRelay ? flying.flatMap(p => {
    const c = cords.find(x => x.id === p.wire)
    if (!c) return []
    const [x, y] = bezierAt(c.gm, p.f)
    return [{ ...p, x, y }]
  }) : []
  const platePackets = isRelay ? [] : flying.filter(p => el.puzzle.segs[p.wire]?.layer === 'plate').map(p => {
    const [x, y] = polylineAt(el.puzzle.segs[p.wire]!.pts, p.f)
    return { ...p, x: x!, y: y! }
  })

  const live = cord ? (() => {
    const a = P[cord.anchor]!
    const picked = m.wires.find(w => w.id === cord.picked)
    return { d: cordD(cordGeo(a, { x: cord.x, y: cord.y })), color: picked ? routeById(picked.route).color : '#E6EDF3', ax: a.x, ay: a.y, bx: Math.round(cord.x), by: Math.round(cord.y) }
  })() : null

  const modules = m.rack.filter(r => !r.block).map(r => {
    const route = routeOfOwner(r.id)
    const st = s.stats[r.id] ?? { in: 0, out: 0 }
    return {
      ...r, stat: 'in ' + st.in + ' · out ' + st.out,
      op: selId === null || route === selId ? 1 : 0.35,
      border: r.id === s.selMod || r.id === s.lift ? '2px solid #E6EDF3' : el.recent(s.hits[r.id]) ? '1px solid #E6EDF3' : route === null ? '1px dashed #4A5564' : '1px solid #303946',
    }
  })

  const leaders: { d: string; color: string; cx: number; cy: number; op: number }[] = []
  if (!isRelay) el.puzzle.pieces.forEach(p => {
    const color = routeById(p.route).color, op = opFor(p.route)
    const cx = Math.round(p.x + p.w / 2), cy = Math.round(p.y + 20)
    p.anchors.forEach(k => { const a = P[k]!; leaders.push({ d: 'M' + a.x + ' ' + a.y + ' L' + cx + ' ' + cy, color, cx, cy, op: op === 1 ? 0.85 : 0.1 }) })
  })

  return html`<div class="plate-bg" style="position:absolute; left:0; top:0; width:${W}px; height:${H}px; overflow:visible; backface-visibility:hidden; -webkit-backface-visibility:hidden">
  ${chassis.map(c => html`<div style="position:absolute; left:${c.x}px; top:${c.y}px; width:${c.w}px; height:${c.h}px; box-sizing:border-box; border:1px dashed ${c.border}; border-radius:4px; background:rgba(22,27,34,0.72); padding:10px 12px; display:flex; flex-direction:column; gap:2px">
    <span style="font-size:12px; font-weight:600; color:#C9D1D9">${c.label}</span>
    <span class="mono" style="font-size:11px; color:#8B96A5">${c.tag}</span>
  </div>`)}

  <div style="position:absolute; left:-20px; top:${H + 32}px; width:${W + 40}px; height:${m.rackH}px; box-sizing:border-box; border-radius:8px; background:#0F1318; border:1px solid #262D38">
    <span class="mono" style="position:absolute; left:14px; bottom:8px; font-size:10px; color:#6E7987; letter-spacing:0.08em">SERVICE RACK</span>
  </div>

  ${isRelay ? modules.map(r => html`<div data-module=${r.id} style="position:absolute; left:${r.x}px; top:${r.y}px; width:${r.w}px; height:92px; box-sizing:border-box; border-radius:6px; background:#1B212A; border:${r.border}; opacity:${r.op}">
    <div style="position:absolute; left:0; right:0; bottom:7px; display:flex; flex-direction:column; align-items:center; gap:1px">
      <span style="font-size:11px; font-weight:600; color:#E6EDF3">${r.title}</span>
      <span class="mono" style="font-size:10px; color:#8B96A5">${r.sub}</span>
      <span class="mono" style="font-size:9.5px; color:#7EE787">${r.stat}</span>
    </div>
  </div>`) : ''}

  <svg width=${W} height=${H} style="position:absolute; left:0; top:0; overflow:visible; pointer-events:none" aria-hidden="true">
    ${jacks.map(j => svg`<g opacity=${j.op}>
      <circle cx=${j.x} cy=${j.y} r=${j.ringR} fill="#0A0D11" stroke=${j.ring} stroke-width="2"></circle>
      <circle cx=${j.x} cy=${j.y} r=${j.coreR} fill=${j.core} stroke="none" stroke-width="1.5"></circle>
      <text x=${j.lx} y=${j.ly} text-anchor=${j.anchor} font-family="JetBrains Mono, monospace" font-size="10" fill="#A3AEBC">${j.label}</text>
    </g>`)}
  </svg>

  ${isRelay ? html`<svg width=${W} height=${H} style="position:absolute; left:0; top:0; overflow:visible; pointer-events:none" aria-hidden="true">
    ${cords.map(w => svg`<g data-wire=${w.id} opacity=${w.op}>
      <path d=${w.d} fill="none" stroke="#000000" stroke-opacity="0.55" stroke-width="7" stroke-linecap="round"></path>
      <path d=${w.d} fill="none" stroke=${w.color} stroke-width="3.5" stroke-linecap="round"></path>
      <path d=${w.d} fill="none" stroke="#FFFFFF" stroke-opacity="0.85" stroke-width="2" stroke-linecap="round" class=${w.sel ? 'flow' : 'noflow'} opacity=${w.sel ? 1 : 0}></path>
      <circle cx=${w.gm.a[0]} cy=${w.gm.a[1]} r="5.5" fill=${w.color} stroke="#0A0D11" stroke-width="1.5"></circle>
      <circle cx=${w.gm.b[0]} cy=${w.gm.b[1]} r="5.5" fill=${w.color} stroke="#0A0D11" stroke-width="1.5"></circle>
    </g>`)}
    ${relayPackets.map(k => packet(k, 6, 3, 10))}
  </svg>` : ''}

  ${live ? html`<svg width=${W} height=${H} style="position:absolute; left:0; top:0; overflow:visible; pointer-events:none" aria-hidden="true">
    <path d=${live.d} fill="none" stroke="#000000" stroke-opacity="0.5" stroke-width="7" stroke-linecap="round"></path>
    <path d=${live.d} fill="none" stroke=${live.color} stroke-width="3.5" stroke-linecap="round" class="live"></path>
    <circle cx=${live.ax} cy=${live.ay} r="6" fill=${live.color} stroke="#0A0D11" stroke-width="1.5"></circle>
    <circle cx=${live.bx} cy=${live.by} r="7" fill=${live.color} stroke="#0A0D11" stroke-width="2"></circle>
  </svg>` : ''}

  ${isRelay ? '' : html`<svg width=${W} height=${H} style="position:absolute; left:0; top:0; overflow:visible; pointer-events:none" aria-hidden="true">
    ${leaders.map(l => svg`<g opacity=${l.op}>
      <path d=${l.d} fill="none" stroke=${l.color} stroke-width="1.5" stroke-dasharray="4 5"></path>
      <circle cx=${l.cx} cy=${l.cy} r="3.5" fill=${l.color}></circle>
    </g>`)}
    ${platePackets.map(k => packet(k, 5, 2.5, 9))}
  </svg>`}
</div>`
}
