// The board: grid, header (summary, notice, storage, Show model, Clear all), drag hints, tiles, and the selection bar.
import { html, nothing } from 'lit'
import { BAD, byIdOf } from './constants'
import { omit, roleOf, typeLabel } from './model'
import type { boardView } from './board'
import type { PuzzlePort } from './puzzle-port'

function renderSel(c: PuzzlePort) {
  const m = c.s.model
  const sa = c.s.selectedAction === null ? undefined : m.actions.find(a => a.id === c.s.selectedAction)
  if (sa === undefined) return nothing
  const typeById = byIdOf(m.types)
  const el = m.elements.find(e => e.id === sa.elementId)!
  const sel = {
    name: sa.name,
    detail: el.name + ' · ' + roleOf(sa) + ' · ' + typeLabel(sa.input, typeById) + ' → ' + typeLabel(sa.output, typeById),
    hasInput: sa.input !== null,
    hasOutput: sa.output !== null,
    placed: m.placements[sa.id] !== undefined,
    inputLabel: sa.inputSide === 'L' ? 'Input: left' : 'Input: top',
    outputLabel: sa.outputSide === 'R' ? 'Output: right' : 'Output: bottom',
    flipInput: () => c.patchAction(sa.id, a => ({ ...a, inputSide: a.inputSide === 'L' ? 'T' : 'L' })),
    flipOutput: () => c.patchAction(sa.id, a => ({ ...a, outputSide: a.outputSide === 'R' ? 'B' : 'R' })),
    unplace: () => c.setModel(mm => ({ ...mm, placements: omit(mm.placements, sa.id) })),
    remove: () => c.removeAction(sa.id)
  }
  return html`<div style="position: absolute; left: 80px; top: 842px; width: 960px; height: 44px; box-sizing: border-box; padding: 0 12px; background: #14171D; border: 1px solid #2A303C; border-radius: 10px; display: flex; align-items: center; gap: 10px; font-size: 12px">
<span style="font-family: 'JetBrains Mono', monospace; font-weight: 600">${sel.name}</span>
<span style="color: #A3AAB8; font-family: 'JetBrains Mono', monospace; font-size: 11px">${sel.detail}</span>
<span style="flex: 1"></span>
${sel.hasInput ? html`<button type="button" @click=${sel.flipInput} style="font-size: 12px; color: #E7E9EE; background: transparent; border: 1px solid #3A4150; border-radius: 6px; padding: 6px 10px; cursor: pointer">${sel.inputLabel}</button>` : nothing}
${sel.hasOutput ? html`<button type="button" @click=${sel.flipOutput} style="font-size: 12px; color: #E7E9EE; background: transparent; border: 1px solid #3A4150; border-radius: 6px; padding: 6px 10px; cursor: pointer">${sel.outputLabel}</button>` : nothing}
${sel.placed ? html`<button type="button" @click=${sel.unplace} style="font-size: 12px; color: #E7E9EE; background: transparent; border: 1px solid #3A4150; border-radius: 6px; padding: 6px 10px; cursor: pointer">Take off</button>` : nothing}
<button type="button" @click=${sel.remove} style="font-size: 12px; color: #FFB4A8; background: transparent; border: 1px solid #5A3A3A; border-radius: 6px; padding: 6px 10px; cursor: pointer">Delete action</button>
</div>`
}

/** The board layer of the canvas. */
export function renderBoard(c: PuzzlePort, b: ReturnType<typeof boardView>) {
  const s = c.s
  const storage = { text: s.storage.text, colour: s.storage.ok ? '#7CE3A1' : BAD }
  return html`<div style="position: absolute; left: 80px; top: 110px; width: 960px; height: 720px; background-image: linear-gradient(#1A1E26 1px, transparent 1px), linear-gradient(90deg, #1A1E26 1px, transparent 1px); background-size: 120px 120px; border-right: 1px solid #1A1E26; border-bottom: 1px solid #1A1E26"></div>

<div style="position: absolute; left: 80px; top: 28px; width: 960px; display: flex; align-items: center; gap: 14px">
<span style="font-size: 13px; color: #A3AAB8">${b.summary}</span>
<span style="font-size: 12px; color: #F5CF5B">${s.notice}</span>
<span style="flex: 1"></span>
<span style="font-size: 11px; color: ${storage.colour}">${storage.text}</span>
<button type="button" @click=${() => c.setState(x => ({ showModel: !x.showModel }))} style="font-size: 12px; color: #E7E9EE; background: #14171D; border: 1px solid #3A4150; border-radius: 6px; padding: 7px 12px; cursor: pointer">${s.showModel ? 'Hide model' : 'Show model'}</button>
<button type="button" @click=${() => c.clearAll()} style="font-size: 12px; color: #E7E9EE; background: #14171D; border: 1px solid #3A4150; border-radius: 6px; padding: 7px 12px; cursor: pointer">Clear all</button>
</div>

${b.emptyBoard ? html`<div style="position: absolute; left: 80px; top: 420px; width: 960px; text-align: center; font-size: 14px; line-height: 22px; color: #6F7787">The board is empty.<br>Add an element and its actions on the left, then drag actions here.</div>` : nothing}

${b.eligible.map(cell => html`<div style="position: absolute; left: ${cell.left}px; top: ${cell.top}px; width: 120px; height: 120px; box-sizing: border-box; background: rgba(124, 227, 161, 0.08); border: 1px dashed rgba(124, 227, 161, 0.5)"></div>`)}
${b.hover.show ? html`<div style="position: absolute; left: ${b.hover.left}px; top: ${b.hover.top}px; width: 120px; height: 120px; box-sizing: border-box; border: 2px solid ${b.hover.colour}; border-radius: 4px"></div>` : nothing}

${b.tiles.map(p => html`<div style="position: absolute; left: ${p.left}px; top: ${p.top}px; width: 200px; height: 200px; pointer-events: none; opacity: ${p.opacity}; filter: ${p.filter}; z-index: ${p.z}">
<svg width="200" height="200" viewBox="0 0 200 200" aria-hidden="true" style="position: absolute; left: 0; top: 0; overflow: visible">
<path d=${p.d} fill=${p.fill} stroke=${p.stroke} stroke-width="1.5" stroke-linejoin="round"></path>
<path d=${p.hole.d} fill=${p.hole.fill} fill-opacity="0.18" stroke=${p.hole.stroke} stroke-width="1.5" stroke-dasharray="3 3"></path>
<path d=${p.knob.d} fill=${p.knob.fill} stroke=${p.knob.stroke} stroke-width=${p.knob.width} stroke-linejoin="round"></path>
<path d=${p.knob.d} fill=${p.knob.pattern} stroke="none"></path>
<path d=${p.knob.inner} fill="none" stroke="#0D0F13" stroke-width="1.5" stroke-opacity="0.6"></path>
<path d=${p.d} fill="none" stroke=${p.selStroke} stroke-width="2.5" stroke-linejoin="round"></path>
</svg>
<div style="position: absolute; left: 40px; top: ${p.nameTop}px; width: 120px; display: flex; flex-direction: column; align-items: center; gap: 2px"><span style="font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600">${p.name}</span><span style="font-size: 11px; color: #A3AAB8">${p.element}</span></div>
${p.labels.map(lb => html`<span style="position: absolute; left: ${lb.left}px; top: ${lb.top}px; width: ${lb.width}px; text-align: ${lb.align}; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: ${lb.colour}">${lb.text}</span>`)}
<div @mousedown=${(e: MouseEvent) => c.startDrag(p.id, false, e)} style="position: absolute; left: 40px; top: 40px; width: 120px; height: 120px; pointer-events: ${p.hit}; cursor: grab"></div>
</div>`)}

${renderSel(c)}`
}
