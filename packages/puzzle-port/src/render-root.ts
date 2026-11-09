// The artboard: pattern defs, the left panel (title, tabs, the active tab) and the puzzle canvas with its overlays.
import { html, nothing } from 'lit'
import type { PuzzlePort } from './puzzle-port'
import { renderElementsTab } from './render-elements'
import { renderTypesTab } from './render-types'
import { renderBoard } from './render-board'
import { boardView } from './board'
import { renderEditor } from './render-editor'
import { renderCode } from './render-code'

/** The whole artboard of a PuzzlePort. */
export function renderRoot(c: PuzzlePort) {
  const s = c.s
  const isEl = s.tab === 'elements'
  const board = boardView(s.model, s.drag, s.selectedAction)
  const tabs = {
    elementsSel: isEl ? 'true' : 'false', typesSel: isEl ? 'false' : 'true',
    elementsBg: isEl ? '#E7E9EE' : 'transparent', typesBg: isEl ? 'transparent' : '#E7E9EE',
    elementsColour: isEl ? '#0D0F13' : '#A3AAB8', typesColour: isEl ? '#A3AAB8' : '#0D0F13',
    toElements: () => c.setState({ tab: 'elements', editorOpen: false, panelErrors: [] }),
    toTypes: () => c.setState({ tab: 'types', panelErrors: [] })
  }
  return html`<div @mousemove=${(e: MouseEvent) => c.moveImpl(e)} @mouseup=${() => c.upImpl()} @mouseleave=${() => c.leave()} style="position: relative; width: 1440px; height: 900px; background: #0D0F13; color: #E7E9EE; font-family: 'Inter', system-ui, sans-serif; overflow: hidden; user-select: none">

<svg width="0" height="0" aria-hidden="true" style="position: absolute"><defs>
<pattern id="pat-diag" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.2" height="6" fill="#0D0F13" fill-opacity="0.6"></rect></pattern>
<pattern id="pat-diag2" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="2.2" height="6" fill="#0D0F13" fill-opacity="0.6"></rect></pattern>
<pattern id="pat-vert" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="2.2" height="6" fill="#0D0F13" fill-opacity="0.6"></rect></pattern>
<pattern id="pat-horiz" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="2.2" fill="#0D0F13" fill-opacity="0.6"></rect></pattern>
<pattern id="pat-dots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.4" fill="#0D0F13" fill-opacity="0.7"></circle></pattern>
</defs></svg>

<div style="position: absolute; left: 0; top: 0; width: 320px; height: 900px; box-sizing: border-box; background: #14171D; border-right: 1px solid #2A303C; display: flex; flex-direction: column">
<div style="padding: 16px 16px 0; display: flex; flex-direction: column; gap: 12px">
<span style="font-size: 16px; font-weight: 700">Puzzle editor</span>
<div role="tablist" style="display: flex; gap: 4px; background: #0D0F13; border: 1px solid #2A303C; border-radius: 8px; padding: 3px">
<button type="button" role="tab" aria-selected=${tabs.elementsSel} @click=${tabs.toElements} style="flex: 1; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; color: ${tabs.elementsColour}; background: ${tabs.elementsBg}; border: 0; border-radius: 6px; padding: 7px 0; cursor: pointer">Elements</button>
<button type="button" role="tab" aria-selected=${tabs.typesSel} @click=${tabs.toTypes} style="flex: 1; font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600; color: ${tabs.typesColour}; background: ${tabs.typesBg}; border: 0; border-radius: 6px; padding: 7px 0; cursor: pointer">Types</button>
</div>
</div>

<div style="flex: 1; overflow-y: auto; padding: 14px 16px 20px; display: flex; flex-direction: column; gap: 12px">
${isEl ? renderElementsTab(c) : renderTypesTab(c)}
</div>
</div>

<div data-canvas="puzzle" style="position: absolute; left: 320px; top: 0; width: 1120px; height: 900px; z-index: 2">
${renderBoard(c, board)}
${renderEditor(c)}
${renderCode(c)}
${s.showModel ? html`<div style="position: absolute; left: 600px; top: 72px; width: 440px; height: 560px; box-sizing: border-box; background: #14171D; border: 1px solid #3A4150; border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 8px; z-index: 50; box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5)">
<span style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #A3AAB8">MODEL</span>
<div style="flex: 1; overflow: auto; font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 16px; color: #C9CED8; white-space: pre; user-select: text">${board.modelJson}</div>
</div>` : nothing}
</div>

</div>`
}
