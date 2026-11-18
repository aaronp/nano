// The back plate: panel chassis, the service rack and its modules, jacks, cords, packets, the live cord, and (in
// puzzle mode) the dashed leaders and their packets.
import { html, nothing, svg } from 'lit'
import { CALL_COLOR, ERR_COLOR, OK_COLOR } from './constants'
import { bezierAt, cordD, cordGeo, polylineAt } from './geometry'
import { opCord } from './calls'
import { jackLabel, twin } from './jacks'
import { checkConnect } from './model'
import { inFlight, packet } from './packets'
import { visibleKeys } from './pointer'
import type { Vals } from './render-root'
import type { Wires } from './wires'

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
    return { ...c, mark: s.hl && c.deploy !== undefined && c.deploy !== 'host', border: onSel ? selRoute!.color : hot ? '#E6EDF3' : '#3A4554' }
  })

  const jackRoute: Record<string, string> = {}
  wires.forEach(w => { jackRoute[w.from] ??= w.route; jackRoute[w.to] ??= w.route })
  const jacks = visibleKeys(el, m).map(k => {
    const p = P[k]!
    const isHover = cord !== null && k === cord.hover
    const isAnchor = cord !== null && k === cord.anchor
    const ring = isHover ? (cord.err ? ERR_COLOR : OK_COLOR) : isAnchor ? '#E6EDF3' : lit(k) ? OK_COLOR : '#4A5564'
    // an input is a hollow socket, an output a filled one; on a module an action's pair shares one label, over both
    const t = twin(P, p), pair = t && p.dir === 'in'
    return {
      key: k, x: p.x, y: p.y, ring, ringR: isHover ? 22 : 18, out: p.dir === 'out',
      label: t && !pair ? '' : jackLabel(p, pair ? 2 * p.slot : p.slot), lx: pair ? Math.round((p.x + t.x) / 2) : p.x,
      ly: p.kind === 'chassis' ? p.y + 42 : p.y - 26,
      op: cord !== null ? (isAnchor || lit(k) ? 1 : 0.3) : selId === null || jackRoute[k] === selId ? 1 : 0.3,
    }
  })

  const cords = (s.showPipes ? wires : []).map(w => {
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
    const mark = s.hl && r.deploy !== 'host'
    return {
      ...r, mark, stat: 'in ' + st.in + ' · out ' + st.out,
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
  ${chassis.map(c => html`<div data-chassis=${c.id} data-deploy=${c.deploy ?? nothing} data-mark=${c.mark ? '' : nothing} style="position:absolute; left:${c.x}px; top:${c.y}px; width:${c.w}px; height:${c.h}px; box-sizing:border-box; border:1px dashed ${c.border}; ${c.mark ? 'outline:2px solid #F5A524; outline-offset:2px; ' : ''}border-radius:4px; background:rgba(22,27,34,0.72); padding:10px 12px; display:flex; flex-direction:column; gap:2px">
    <span style="font-size:12px; font-weight:600; color:#C9D1D9">${c.label}</span>
    <span class="mono" style="font-size:11px; color:#8B96A5">${c.tag}</span>
  </div>`)}

  <div style="position:absolute; left:-20px; top:${H + 32}px; width:${W + 40}px; height:${m.rackH}px; box-sizing:border-box; border-radius:8px; background:#0F1318; border:1px solid #262D38">
    <span class="mono" style="position:absolute; left:14px; bottom:8px; font-size:10px; color:#6E7987; letter-spacing:0.08em">SERVICE RACK</span>
  </div>

  ${isRelay ? modules.map(r => html`<div data-module=${r.id} data-deploy=${r.deploy} data-mark=${r.mark ? '' : nothing} style="position:absolute; left:${r.x}px; top:${r.y}px; width:${r.w}px; height:${r.h}px; box-sizing:border-box; border-radius:6px; background:#1B212A; border:${r.border}; ${r.mark ? 'outline:2px solid #F5A524; outline-offset:2px; ' : ''}opacity:${r.op}">
    <div style="position:absolute; left:10px; right:10px; top:6px; display:flex; align-items:baseline; gap:10px; white-space:nowrap; overflow:hidden">
      <span style="font-size:18px; font-weight:600; color:#E6EDF3">${r.title}</span>
      <span class="mono" style="font-size:12px; color:#8B96A5">${r.sub}</span>
      <span class="mono" style="font-size:12px; color:#7EE787">${r.stat}</span>
    </div>
  </div>`) : ''}

  <svg width=${W} height=${H} style="position:absolute; left:0; top:0; overflow:visible; pointer-events:none" aria-hidden="true">
    ${jacks.map(j => svg`<g data-jack=${j.key} opacity=${j.op}>
      <circle cx=${j.x} cy=${j.y} r=${j.ringR} fill="#0A0D11" stroke=${j.ring} stroke-width="3"></circle>
      <circle data-dir=${j.out ? 'out' : 'in'} cx=${j.x} cy=${j.y} r="9" fill=${j.out ? '#E6EDF3' : '#0A0D11'} stroke=${j.out ? 'none' : '#8B96A5'} stroke-width="2"></circle>
      <text x=${j.lx} y=${j.ly} text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="20" fill="#C9D1D9">${j.label}</text>
    </g>`)}
  </svg>

  ${isRelay ? html`<svg width=${W} height=${H} style="position:absolute; left:0; top:0; overflow:visible; pointer-events:none" aria-hidden="true">
    ${cords.map(w => svg`<g data-wire=${w.id} opacity=${w.op}>
      <path class="glow" d=${w.d} fill="none" stroke=${w.color} stroke-opacity="0.3" stroke-width="16" stroke-linecap="round"></path>
      <path d=${w.d} fill="none" stroke="#000000" stroke-opacity="0.6" stroke-width="9" stroke-linecap="round"></path>
      <path d=${w.d} fill="none" stroke=${w.color} stroke-width="5" stroke-linecap="round"></path>
      <path d=${w.d} fill="none" stroke="#FFFFFF" stroke-opacity=${w.sel ? 0.95 : 0.5} stroke-width="2" stroke-linecap="round" class="flow"></path>
      <circle cx=${w.gm.a[0]} cy=${w.gm.a[1]} r="7" fill=${w.color} stroke="#0A0D11" stroke-width="2"></circle>
      <circle cx=${w.gm.b[0]} cy=${w.gm.b[1]} r="7" fill=${w.color} stroke="#0A0D11" stroke-width="2"></circle>
    </g>`)}
    ${s.showCalls ? m.calls.map(c => svg`<g data-call=${c.id} opacity=${selId === null ? 0.9 : 0.3}>
      ${c.b.map(b => svg`<path d=${cordD(cordGeo(c.a, b))} fill="none" stroke=${CALL_COLOR} stroke-opacity="0.6" stroke-width="2.5" stroke-dasharray="10 6" stroke-linecap="round"></path>
      <circle cx=${b.x} cy=${b.y} r="5" fill=${CALL_COLOR}></circle>`)}
      ${c.b.length ? svg`<circle cx=${c.a.x} cy=${c.a.y} r="5" fill=${CALL_COLOR}></circle>
      <text x=${c.a.x + 8} y=${c.a.y + 20} font-family="JetBrains Mono, monospace" font-size="16" fill=${CALL_COLOR}>calls ${c.to}</text>` : ''}
      ${(c.ops ?? []).map(opCord)}</g>`) : ''}
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
