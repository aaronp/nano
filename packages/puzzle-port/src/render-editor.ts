// The shape editor overlay: the big edge with draggable points and handles, presets, colours, patterns and points.
import { html, nothing } from 'lit'
import { live } from 'lit/directives/live.js'
import { PATTERNS, SWATCHES, byIdOf, fmt, round1, type Pt } from './constants'
import { PRESET_LABELS, PRESET_ORDER, anchorOf, edgeAt, makeEdge, presetIcon, presetShape, shapeSegments, type Target } from './geometry'
import { usesOf } from './model'
import type { PuzzlePort } from './puzzle-port'

/** The shape editor, when a type is selected and the editor is open. */
export function renderEditor(c: PuzzlePort) {
  const s = c.s
  const m = s.model
  const st = s.selectedType === null ? undefined : byIdOf(m.types)[s.selectedType]
  if (st === undefined || !s.editorOpen) return nothing
  const e = makeEdge([200, 20], [0, 1], [1, 0], 3)
  const seg = shapeSegments(e, 1, st.shape, 1)
  const n = st.shape.segs.length
  const down = (target: Target) => (ev: MouseEvent) => c.handleDown(target, ev)
  const place = (pt: Pt, size: number) => { const q = edgeAt(e, 1, pt[0], pt[1]); return { left: round1(q[0] - size / 2 - 1), top: round1(q[1] - size / 2 - 1) } }
  const controls = st.shape.segs.flatMap((sg, i) => [
    { size: 10, radius: '50%', bg: '#9EC3FF', border: '#0D0F13', label: 'Curve handle', onDown: down({ kind: 'c1', index: i }), ...place(sg.c1, 10) },
    { size: 10, radius: '50%', bg: '#9EC3FF', border: '#0D0F13', label: 'Curve handle', onDown: down({ kind: 'c2', index: i }), ...place(sg.c2, 10) }
  ])
  const anchors = Array.from({ length: n + 1 }, (_, k) => {
    const on = s.selectedAnchor === k
    const end = k === 0 || k === n
    return { size: 13, radius: '2px', bg: on ? '#9EC3FF' : (end ? '#4A5263' : '#0D0F13'), border: '#E7E9EE', label: end ? 'End point' : 'Point', onDown: down({ kind: 'anchor', index: k }), ...place(anchorOf(st.shape, k), 13) }
  })
  const editor = {
    name: st.name,
    body: 'M 40 20 L 200 20 L ' + fmt(seg.start) + ' ' + seg.body + ' L 200 380 L 40 380 Z',
    knob: 'M ' + fmt(seg.start) + ' ' + seg.body + ' Z',
    colour: st.colour,
    pattern: st.pattern === 'none' ? 'none' : 'url(#pat-' + st.pattern + ')',
    handleLines: st.shape.segs.map((sg, i) => {
      const a = anchorOf(st.shape, i)
      return 'M ' + fmt(edgeAt(e, 1, a[0], a[1])) + ' L ' + fmt(edgeAt(e, 1, sg.c1[0], sg.c1[1])) + ' M ' + fmt(edgeAt(e, 1, sg.p[0], sg.p[1])) + ' L ' + fmt(edgeAt(e, 1, sg.c2[0], sg.c2[1]))
    }).join(' '),
    handles: controls.concat(anchors),
    presets: PRESET_ORDER.map(id => {
      const on = st.shape.preset === id
      return { label: PRESET_LABELS[id]!, d: presetIcon(presetShape(id)), bg: on ? '#212632' : 'transparent', border: on ? '#9B8CFF' : '#2A303C', pick: () => { c.patchLook(st.id, t => ({ ...t, shape: presetShape(id) })); c.setState({ selectedAnchor: null, editorMessage: '' }) } }
    }),
    swatches: SWATCHES.map(col => ({ colour: col, label: 'Colour ' + col, ring: col === st.colour ? '#E7E9EE' : 'transparent', pick: () => c.patchLook(st.id, t => ({ ...t, colour: col })) })),
    patterns: PATTERNS.map(p => ({ label: p.label, bg: st.pattern === p.id ? '#212632' : 'transparent', border: st.pattern === p.id ? '#9B8CFF' : '#2A303C', pick: () => c.patchLook(st.id, t => ({ ...t, pattern: p.id })) })),
    shaText: st.builtIn ? 'Built-in shape' : (st.shapeSource === 'sha' ? 'Generated from SHA ' + st.sha!.slice(0, 10) : 'Customised · SHA ' + st.sha!.slice(0, 10)),
    canRegenerate: !st.builtIn && st.shapeSource !== 'sha',
    pointText: (n + 1) + ' points' + (s.selectedAnchor === null ? '' : ' · point ' + (s.selectedAnchor + 1) + ' selected'),
    usage: (() => { const u = usesOf(m, st.id); return u.length === 0 ? 'Not used yet.' : 'Used by ' + u.join(', ') + '.' })()
  }
  return html`<div style="position: absolute; left: 0; top: 0; width: 1120px; height: 900px; background: rgba(13, 15, 19, 0.82); z-index: 60"></div>
<div style="position: absolute; left: 120px; top: 80px; width: 880px; height: 700px; box-sizing: border-box; background: #14171D; border: 1px solid #3A4150; border-radius: 14px; padding: 22px 24px; display: flex; gap: 24px; z-index: 61; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6)">
<div style="display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; align-items: baseline; gap: 10px"><span style="font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 700">${editor.name}</span><span style="font-size: 12px; color: #A3AAB8">edge shape</span></div>
<div data-shape-editor="1" @mousemove=${(ev: MouseEvent) => c.editorMove(ev)} @mouseup=${() => c.editorUp()} @mouseleave=${() => c.editorUp()} style="position: relative; width: 420px; height: 400px; background: #0D0F13; border: 1px solid #2A303C; border-radius: 10px; box-sizing: border-box">
<svg width="420" height="400" viewBox="0 0 420 400" aria-hidden="true" style="position: absolute; left: -1px; top: -1px">
<path d="M 200 20 L 200 380" stroke="#2A303C" stroke-width="1" stroke-dasharray="4 4"></path>
<path d=${editor.body} fill="#1A1E26" stroke="#4A5263" stroke-width="2" stroke-linejoin="miter"></path>
<path d=${editor.knob} fill=${editor.colour} stroke="#4A5263" stroke-width="2"></path>
<path d=${editor.knob} fill=${editor.pattern} stroke="none"></path>
<path d=${editor.handleLines} fill="none" stroke="#9EC3FF" stroke-width="1.2"></path>
</svg>
${editor.handles.map(h => html`<div @mousedown=${h.onDown} aria-label=${h.label} style="position: absolute; left: ${h.left}px; top: ${h.top}px; width: ${h.size}px; height: ${h.size}px; box-sizing: border-box; border-radius: ${h.radius}; background: ${h.bg}; border: 2px solid ${h.border}; cursor: move"></div>`)}
</div>
<span style="width: 420px; font-size: 12px; line-height: 18px; color: #A3AAB8">Drag the square points to move the outline; drag the round handles to bend the curves. The two end points stay on the edge and slide along it.</span>
</div>
<div style="flex: 1; display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; justify-content: flex-end"><button type="button" @click=${() => c.setState({ editorOpen: false })} style="font-size: 12px; font-weight: 600; color: #0D0F13; background: #E7E9EE; border: 0; border-radius: 6px; padding: 7px 14px; cursor: pointer">Done</button></div>
<div style="display: flex; flex-direction: column; gap: 8px"><span style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #A3AAB8">STARTING SHAPES</span>
<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px">
${editor.presets.map(ps => html`<button type="button" @click=${ps.pick} aria-label=${ps.label} style="height: 56px; background: ${ps.bg}; border: 1px solid ${ps.border}; border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px"><svg width="40" height="30" viewBox="0 0 40 30" aria-hidden="true"><path d=${ps.d} fill=${editor.colour} stroke="#4A5263" stroke-width="1"></path></svg><span style="font-size: 9px; color: #A3AAB8">${ps.label}</span></button>`)}
</div></div>
<div style="display: flex; flex-direction: column; gap: 8px"><span style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #A3AAB8">COLOUR</span>
<div style="display: flex; flex-wrap: wrap; gap: 6px">
${editor.swatches.map(sw => html`<button type="button" @click=${sw.pick} aria-label=${sw.label} style="width: 28px; height: 28px; border-radius: 6px; background: ${sw.colour}; border: 2px solid ${sw.ring}; cursor: pointer"></button>`)}
</div></div>
<div style="display: flex; flex-direction: column; gap: 8px"><span style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #A3AAB8">PATTERN · marks a brand</span>
<div style="display: flex; flex-wrap: wrap; gap: 6px">
${editor.patterns.map(pt => html`<button type="button" @click=${pt.pick} style="font-size: 11px; color: #E7E9EE; background: ${pt.bg}; border: 1px solid ${pt.border}; border-radius: 6px; padding: 5px 9px; cursor: pointer">${pt.label}</button>`)}
</div></div>
<div style="display: flex; flex-direction: column; gap: 8px"><span style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #A3AAB8">POINTS · ${editor.pointText}</span>
<div style="display: flex; flex-wrap: wrap; gap: 6px">
<button type="button" @click=${() => c.addPoint()} style="font-size: 12px; color: #E7E9EE; background: transparent; border: 1px solid #3A4150; border-radius: 6px; padding: 7px 12px; cursor: pointer">Add point</button>
<button type="button" @click=${() => c.removePoint()} style="font-size: 12px; color: #E7E9EE; background: transparent; border: 1px solid #3A4150; border-radius: 6px; padding: 7px 12px; cursor: pointer">Remove point</button>
<label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: #E7E9EE"><input type="checkbox" .checked=${live(s.mirror)} @change=${() => c.setState(x => ({ mirror: !x.mirror }))} style="accent-color: #9B8CFF">Mirror handles</label>
</div>
<span style="font-size: 11px; color: #F5CF5B">${s.editorMessage}</span>
</div>
<span style="font-size: 12px; line-height: 18px; color: #A3AAB8">${editor.usage}</span>
<div style="display: flex; align-items: center; gap: 10px"><span style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #A3AAB8">${editor.shaText}</span>
${editor.canRegenerate ? html`<button type="button" @click=${() => c.regenerate(st.id)} style="font-size: 12px; color: #E7E9EE; background: transparent; border: 1px solid #3A4150; border-radius: 6px; padding: 6px 10px; cursor: pointer">Regenerate from SHA</button>` : nothing}
</div>
</div>
</div>`
}
