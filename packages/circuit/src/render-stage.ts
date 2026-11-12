// The stage: a tilted stack of page layers, the side area of systems, cables, pads, and the minimap.
import { html, svg } from 'lit'
import { styleMap } from 'lit/directives/style-map.js'
import type { Circuit } from './circuit'
import { DIM_CABLE, MARGIN, PH, PW, TILT, TYPE_COLOR, TYPE_GLYPH, TYPE_NAME, ZGAP, fade } from './constants'
import { frameId, posKey, type Frame, type PlacedBox, type PlacedPad, type Rect } from './layout'
import type { Cable } from './types'

const px = (r: Rect) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` })

/** A pad: a 24px button. Events are round, calls rounded squares; inputs hollow, outputs filled. */
function pad({ pad: p, x, y }: PlacedPad) {
  const c = TYPE_COLOR[p.type], out = p.dir === 'out'
  const style = { left: `${x - 12}px`, top: `${y - 12}px`, borderColor: c, background: out ? c : 'transparent', color: out ? '#0B0E12' : c, borderRadius: p.kind === 'event' ? '50%' : '6px' }
  return html`<button class="pad" data-pad=${p.key} data-dir=${p.dir} data-kind=${p.kind} style=${styleMap(style)} title=${p.description ?? ''}
    aria-label=${`${p.instance}.${p.label}, ${TYPE_NAME[p.type]}, ${p.dir}`}>${TYPE_GLYPH[p.type]}</button>
    <span class="plabel ${p.dir}" style=${styleMap({ top: `${y - 7}px`, ...(out ? { right: `calc(100% - ${x - 18}px)`, textAlign: 'right' } : { left: `${x + 18}px` }) })}>${p.label}</span>`
}

function box(b: PlacedBox, shared: boolean) {
  const { item } = b
  return html`<div class="fp" data-instance=${item.instance} style=${styleMap(px(b.rect))}>
    ${b.tabs.length ? '' : html`<span class="ftitle">${item.title}${shared ? ' ⧉' : ''}</span>`}
    ${b.pads.map(pad)}</div>
    ${b.tabs.map(t => html`<button class="tab" data-tab=${t.fp.instance} aria-pressed=${t.active} data-cx=${t.rect.x + t.rect.w / 2} data-cy=${t.rect.y + t.rect.h / 2}
      style=${styleMap(px(t.rect))}>${t.fp.title}</button>`)}`
}

/** A cable is a bezier between two pad centres, drawn in its source's frame. Full strength only on the focus layer. */
function cables(el: Circuit, f: Frame) {
  const { pos } = el.geo, focusFrame = `l:${el.s.focus}`
  return svg`<svg class="cables" width="1" height="1" aria-hidden="true">${el.model.cables.filter(c => frameId(c.from.at) === f.id).map((c: Cable) => {
    const a = pos.get(posKey(f.id, c.from.pad)), b = pos.get(posKey(frameId(c.to.at), c.to.pad))
    if (!a || !b) return ''
    const x1 = a.x - f.origin.x, y1 = a.y - f.origin.y, x2 = b.x - f.origin.x, y2 = b.y - f.origin.y, dx = Math.max(40, Math.abs(x2 - x1) / 2)
    const full = frameId(c.from.at) === focusFrame || frameId(c.to.at) === focusFrame || (f.id.startsWith('s:') && frameId(c.to.at).startsWith('s:'))
    return svg`<path data-cable=${c.id} data-x1=${x1} data-y1=${y1} data-x2=${x2} data-y2=${y2} d=${`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`}
      fill="none" stroke=${TYPE_COLOR[c.type]} stroke-width="2" opacity=${full ? 1 : DIM_CABLE}/>`
  })}</svg>`
}

function minimap(el: Circuit) {
  const { bounds: b, layers, blocks } = el.geo, { panX, panY, zoom, focus } = el.s, { w, h } = el.stageSize()
  const vp = { x: -panX / zoom - w / zoom / 2, y: -panY / zoom - h / zoom / 2, w: w / zoom, h: h / zoom }
  return html`<svg class="minimap" role="img" aria-label="Minimap" viewBox=${`${b.x - MARGIN} ${b.y - MARGIN} ${b.w + 2 * MARGIN} ${b.h + 2 * MARGIN}`}
    @click=${(e: MouseEvent) => el.panFromMinimap(e)}>
    ${layers.map(l => svg`<rect class="mm-layer" data-focus=${l.layer.screen === focus} x=${l.rect.x} y=${l.rect.y} width=${l.rect.w} height=${l.rect.h}/>`)}
    ${blocks.map(l => svg`<rect class="mm-side" x=${l.rect.x} y=${l.rect.y} width=${l.rect.w} height=${l.rect.h}/>`)}
    <rect class="mm-view" x=${vp.x} y=${vp.y} width=${vp.w} height=${vp.h}/></svg>`
}

export function renderStage(el: Circuit) {
  const { focus, zoom, panX, panY } = el.s, reduced = el.reduced(), at = el.model.layers.findIndex(l => l.screen === focus)
  const world = { transform: `${reduced ? '' : TILT} translate(${panX}px, ${panY}px) scale(${zoom})` }
  return html`<div class="stage" tabindex="0" aria-label="Circuit" @pointerdown=${(e: PointerEvent) => el.dragStart(e)} @wheel=${(e: WheelEvent) => el.wheel(e)}>
    <div class="world ${el.dragging || reduced ? '' : 'anim'}" style=${styleMap(world)}>
      ${el.geo.layers.map(f => {
        const d = f.index - at, l = f.layer
        return html`<div class="frame" data-screen=${l.screen} style=${styleMap({ left: `${f.origin.x}px`, top: `${f.origin.y}px`, transform: `translateZ(${-Math.abs(d) * ZGAP}px)` })}>
          <section class="layer" aria-label=${l.title} data-focus=${d === 0} style=${styleMap({ width: `${PW}px`, height: `${PH}px`, opacity: String(fade(d)) })}>
            <h3 class="ltitle">${l.title}</h3>
            ${f.boxes.map(b => box(b, 'shared' in b.item && b.item.shared))}</section>
          ${cables(el, f)}</div>`
      })}
      ${el.geo.blocks.map(f => html`<div class="frame side" data-system=${f.block.system} style=${styleMap({ left: `${f.origin.x}px`, top: `${f.origin.y}px` })}>
        <h3 class="ltitle">${f.block.system}</h3>${f.boxes.map(b => box(b, false))}${cables(el, f)}</div>`)}
    </div>
    ${minimap(el)}</div>`
}
