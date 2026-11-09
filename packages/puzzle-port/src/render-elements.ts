// The Elements tab: the new-element draft, each element with its action form and draggable actions.
import { html, nothing } from 'lit'
import { live } from 'lit/directives/live.js'
import { ROLES, bug, byIdOf, type TypeDef } from './constants'
import { iconFor, presetShape } from './geometry'
import { roleOf, typeLabel } from './model'
import type { ActionForm, PuzzlePort, State } from './puzzle-port'

type DraftKey = 'elementDraft' | 'typeDraft'
/** The prototype's `draft` helper: an inline name field that opens from a dashed button. */
export function draft(c: PuzzlePort, setter: DraftKey, save: () => void) {
  const val = c.s[setter]
  return {
    open: val !== null, closed: val === null, value: val ?? '',
    onChange: (e: Event) => c.setState({ [setter]: (e.target as HTMLInputElement).value } as Partial<State>),
    save, cancel: () => c.setState({ [setter]: null, panelErrors: [] } as Partial<State>), open_: () => c.setState({ [setter]: '', panelErrors: [] } as Partial<State>)
  }
}
/** The panel's error lines. */
export const panelErrors = (c: PuzzlePort) => c.s.panelErrors.map(text => html`<span style="font-size: 11px; color: #FF8A80">${text}</span>`)

function pickerView(c: PuzzlePort, kind: 'in' | 'out', f: ActionForm, typeById: Record<string, TypeDef>, types: TypeDef[]) {
  const isIn = kind === 'in'
  const current = isIn ? f.input : f.output
  const query = (isIn ? f.inQuery : f.outQuery).trim().toLowerCase()
  const arr = isIn ? f.inArray : f.outArray
  const noneChip = { label: 'none', colour: '#4A5263', pressed: current === null ? 'true' : 'false', bg: current === null ? '#212632' : 'transparent', border: current === null ? '#A3AAB8' : '#2A303C', pick: () => c.patchActionForm(isIn ? { input: null } : { output: null }) }
  const chips = types.filter(t => query === '' || t.name.toLowerCase().includes(query)).map(t => {
    const on = current === t.id
    return { label: t.name, colour: t.colour, pressed: on ? 'true' : 'false', bg: on ? '#212632' : 'transparent', border: on ? t.colour : '#2A303C', pick: () => c.patchActionForm(isIn ? { input: t.id } : { output: t.id }) }
  })
  return {
    title: isIn ? 'Input (hole):' : 'Output (knob):',
    current: current === null ? 'none' : typeById[current]!.name + (arr ? '[]' : ''),
    array: arr,
    toggleArray: () => c.patchActionForm(isIn ? { inArray: !f.inArray } : { outArray: !f.outArray }),
    query: isIn ? f.inQuery : f.outQuery,
    searchLabel: isIn ? 'Filter input types' : 'Filter output types',
    setQuery: (e: Event) => c.patchActionForm(isIn ? { inQuery: (e.target as HTMLInputElement).value } : { outQuery: (e.target as HTMLInputElement).value }),
    chips: [noneChip].concat(chips)
  }
}

function renderActionForm(c: PuzzlePort, f: ActionForm, typeById: Record<string, TypeDef>) {
  const pickers = [pickerView(c, 'in', f, typeById, c.s.model.types), pickerView(c, 'out', f, typeById, c.s.model.types)]
  return html`<div style="background: #1A1E26; border: 1px solid #3A4150; border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px">
<input type="text" aria-label="Action name" .value=${live(f.name)} @input=${(e: Event) => c.patchActionForm({ name: (e.target as HTMLInputElement).value })} placeholder="Action name" style="height: 30px; box-sizing: border-box; padding: 0 8px; background: #0D0F13; border: 1px solid #3A4150; border-radius: 6px; color: #E7E9EE; font-family: 'JetBrains Mono', monospace; font-size: 12px">
${pickers.map(pk => html`<div style="display: flex; flex-direction: column; gap: 5px">
<div style="display: flex; align-items: center; gap: 6px"><span style="flex: 1; font-size: 11px; color: #A3AAB8">${pk.title} <b style="color: #E7E9EE; font-family: 'JetBrains Mono', monospace">${pk.current}</b></span><label style="display: flex; align-items: center; gap: 4px; font-size: 11px; color: #A3AAB8"><input type="checkbox" .checked=${live(pk.array)} @change=${pk.toggleArray} style="accent-color: #6FA8FF">array</label></div>
<input type="search" aria-label=${pk.searchLabel} .value=${live(pk.query)} @input=${pk.setQuery} placeholder="filter types" style="height: 26px; box-sizing: border-box; padding: 0 8px; background: #0D0F13; border: 1px solid #2A303C; border-radius: 5px; color: #E7E9EE; font-size: 11px">
<div style="display: flex; flex-wrap: wrap; gap: 4px">
${pk.chips.map(ch => html`<button type="button" @click=${ch.pick} aria-pressed=${ch.pressed} style="display: flex; align-items: center; gap: 5px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #E7E9EE; background: ${ch.bg}; border: 1px solid ${ch.border}; border-radius: 5px; padding: 3px 6px; cursor: pointer"><span style="width: 8px; height: 8px; border-radius: 50%; background: ${ch.colour}"></span>${ch.label}</button>`)}
</div>
</div>`)}
${f.errors.map(text => html`<span style="font-size: 11px; color: #FF8A80">${text}</span>`)}
<div style="display: flex; gap: 6px"><button type="button" @click=${() => c.saveAction()} style="flex: 1; height: 30px; font-size: 12px; font-weight: 600; color: #0D0F13; background: #6FA8FF; border: 0; border-radius: 6px; cursor: pointer">Add action</button><button type="button" @click=${() => c.setState({ actionForm: null })} style="height: 30px; font-size: 12px; color: #A3AAB8; background: transparent; border: 1px solid #3A4150; border-radius: 6px; padding: 0 10px; cursor: pointer">Cancel</button></div>
</div>`
}

/** The Elements tab. */
export function renderElementsTab(c: PuzzlePort) {
  const s = c.s
  const m = s.model
  const typeById = byIdOf(m.types)
  const f = s.actionForm
  const elementDraft = draft(c, 'elementDraft', () => c.saveElement())
  const elements = m.elements.map(el => ({
    name: el.name.toUpperCase(),
    addLabel: 'Add action to ' + el.name,
    removeLabel: 'Delete element ' + el.name,
    addAction: () => c.setState({ actionForm: c.blankActionForm(el.id) }),
    remove: () => c.removeElement(el.id),
    formOpen: f !== null && f.elementId === el.id,
    actions: m.actions.filter(a => a.elementId === el.id).map(a => {
      const role = ROLES[roleOf(a)]
      const outT = a.output === null ? null : typeById[a.output.typeId] ?? bug('missing type')
      const inT = a.input === null ? null : typeById[a.input.typeId] ?? bug('missing type')
      const icon = iconFor(outT !== null ? outT.shape : presetShape('flat'))
      const placed = m.placements[a.id] !== undefined
      return {
        name: a.name,
        signature: (a.input === null ? '' : typeLabel(a.input, typeById)) + ' → ' + (a.output === null ? '' : typeLabel(a.output, typeById)),
        status: placed ? 'placed' : 'loose',
        statusColour: placed ? '#A3AAB8' : '#F5CF5B',
        bg: s.selectedAction === a.id ? '#212632' : 'transparent',
        icon: { body: icon.body, knob: outT === null ? '' : icon.knob, fill: role.fill, stroke: inT !== null ? inT.colour : role.stroke, knobFill: outT === null ? 'none' : outT.colour },
        onDown: (e: MouseEvent) => c.startDrag(a.id, true, e)
      }
    })
  }))
  return html`<div style="display: flex; flex-direction: column; gap: 12px">
${elementDraft.open ? html`<div style="display: flex; gap: 6px"><input type="text" aria-label="New element name" .value=${live(elementDraft.value)} @input=${elementDraft.onChange} placeholder="Element name, e.g. Payments" style="flex: 1; min-width: 0; height: 32px; box-sizing: border-box; padding: 0 8px; background: #0D0F13; border: 1px solid #3A4150; border-radius: 6px; color: #E7E9EE; font-size: 12px"><button type="button" @click=${elementDraft.save} style="font-size: 12px; font-weight: 600; color: #0D0F13; background: #6FA8FF; border: 0; border-radius: 6px; padding: 0 12px; cursor: pointer">Add</button><button type="button" @click=${elementDraft.cancel} aria-label="Cancel" style="font-size: 12px; color: #A3AAB8; background: transparent; border: 1px solid #3A4150; border-radius: 6px; padding: 0 10px; cursor: pointer">✕</button></div>` : nothing}
${elementDraft.closed ? html`<button type="button" @click=${elementDraft.open_} style="height: 34px; font-size: 13px; font-weight: 600; color: #E7E9EE; background: transparent; border: 1px dashed #4A5263; border-radius: 8px; cursor: pointer">+ Element</button>` : nothing}
${panelErrors(c)}
${m.elements.length === 0 ? html`<span style="font-size: 12px; line-height: 18px; color: #A3AAB8">An element is a namespace for actions. Add one, then use its + to add actions you can drag onto the board.</span>` : nothing}

${elements.map(el => html`<div style="display: flex; flex-direction: column; gap: 4px; border-top: 1px solid #2A303C; padding-top: 10px">
<div style="display: flex; align-items: center; gap: 8px"><span style="flex: 1; font-size: 12px; font-weight: 700; letter-spacing: 0.06em">${el.name}</span><button type="button" @click=${el.addAction} aria-label=${el.addLabel} style="width: 26px; height: 26px; font-size: 16px; line-height: 1; color: #E7E9EE; background: #212632; border: 1px solid #3A4150; border-radius: 6px; cursor: pointer">+</button><button type="button" @click=${el.remove} aria-label=${el.removeLabel} style="width: 26px; height: 26px; font-size: 12px; color: #A3AAB8; background: transparent; border: 1px solid #2A303C; border-radius: 6px; cursor: pointer">✕</button></div>

${el.formOpen && f !== null ? renderActionForm(c, f, typeById) : nothing}

${el.actions.map(ac => html`<div @mousedown=${ac.onDown} style="display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 6px; background: ${ac.bg}; cursor: grab">
<svg width="30" height="26" viewBox="0 0 30 26" aria-hidden="true"><path d=${ac.icon.body} fill=${ac.icon.fill} stroke=${ac.icon.stroke} stroke-width="1"></path><path d=${ac.icon.knob} fill=${ac.icon.knobFill} stroke=${ac.icon.stroke} stroke-width="0.8"></path></svg>
<span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px"><span style="font-family: 'JetBrains Mono', monospace; font-size: 12px">${ac.name}</span><span style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #A3AAB8">${ac.signature}</span></span>
<span style="font-size: 10px; color: ${ac.statusColour}">${ac.status}</span>
</div>`)}
</div>`)}
</div>`
}
