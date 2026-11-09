// The Types tab: List/Code switch, the new-record draft, grouped types, and the selected type's detail.
import { html, nothing } from 'lit'
import { live } from 'lit/directives/live.js'
import { byIdOf } from './constants'
import { iconFor } from './geometry'
import type { PuzzlePort } from './puzzle-port'
import { draft, panelErrors } from './render-elements'

/** The List/Code switch's look and actions (shared with the code overlay). */
export function codeTabs(c: PuzzlePort) {
  const open = c.s.codeOpen
  return {
    listPressed: open ? 'false' : 'true', codePressed: open ? 'true' : 'false',
    listBg: open ? 'transparent' : '#212632', codeBg: open ? '#212632' : 'transparent',
    toList: () => c.setState({ codeOpen: false, codeMessage: '' }),
    toCode: () => c.openCode()
  }
}

function renderDetail(c: PuzzlePort) {
  const s = c.s
  const m = s.model
  const typeById = byIdOf(m.types)
  const st = s.selectedType === null ? undefined : typeById[s.selectedType]
  if (st === undefined) return nothing
  const fp = s.fieldPicker
  const fields = st.kind !== 'record' ? [] : st.fields!.map((fd, i) => {
    const ft = typeById[fd.typeId]!
    const open = fp !== null && fp.typeId === st.id && fp.index === i
    return {
      name: fd.name,
      setName: (e: Event) => c.patchField(st.id, i, { name: (e.target as HTMLInputElement).value }),
      typeLabel: ft.name, colour: ft.colour, array: fd.array,
      toggleArray: () => c.patchField(st.id, i, { array: !fd.array }),
      togglePicker: () => c.setState({ fieldPicker: open ? null : { typeId: st.id, index: i } }),
      pickerOpen: open,
      chips: m.types.filter(t => t.id !== st.id).map(t => ({ label: t.name, colour: t.colour, bg: t.id === fd.typeId ? '#212632' : 'transparent', border: t.id === fd.typeId ? t.colour : '#2A303C', pick: () => { c.patchField(st.id, i, { typeId: t.id }); c.setState({ fieldPicker: null }) } })),
      remove: () => c.patchType(st.id, t => ({ ...t, fields: t.fields!.filter((_, j) => j !== i) }))
    }
  })
  const addField = () => c.patchType(st.id, t => ({ ...t, fields: t.fields!.concat([{ name: 'field' + (t.fields!.length + 1), typeId: 'string', array: false }]) }))
  const bd = s.brandDraft
  return html`<div style="background: #1A1E26; border: 1px solid #3A4150; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px">
<div style="display: flex; align-items: baseline; gap: 8px"><span style="font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 700">${st.name}</span><span style="font-size: 11px; color: #A3AAB8">${st.kind === 'primitive' ? 'built-in' : st.kind}</span></div>
${st.kind === 'record' ? html`<div style="display: flex; flex-direction: column; gap: 6px">
<span style="font-size: 11px; color: #A3AAB8">Fields</span>
${fields.map(fd => html`<div style="display: flex; flex-direction: column; gap: 4px">
<div style="display: flex; align-items: center; gap: 4px">
<input type="text" aria-label="Field name" .value=${live(fd.name)} @input=${fd.setName} placeholder="field" style="width: 84px; height: 26px; box-sizing: border-box; padding: 0 6px; background: #0D0F13; border: 1px solid #3A4150; border-radius: 5px; color: #E7E9EE; font-family: 'JetBrains Mono', monospace; font-size: 11px">
<button type="button" @click=${fd.togglePicker} style="flex: 1; display: flex; align-items: center; gap: 5px; height: 26px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #E7E9EE; background: #0D0F13; border: 1px solid #3A4150; border-radius: 5px; padding: 0 6px; cursor: pointer"><span style="width: 8px; height: 8px; border-radius: 50%; background: ${fd.colour}"></span>${fd.typeLabel}</button>
<label style="display: flex; align-items: center; gap: 3px; font-size: 10px; color: #A3AAB8"><input type="checkbox" .checked=${live(fd.array)} @change=${fd.toggleArray} style="accent-color: #6FA8FF">[ ]</label>
<button type="button" @click=${fd.remove} aria-label="Remove field" style="width: 22px; height: 26px; font-size: 11px; color: #A3AAB8; background: transparent; border: 0; cursor: pointer">✕</button>
</div>
${fd.pickerOpen ? html`<div style="display: flex; flex-wrap: wrap; gap: 4px; padding-left: 88px">
${fd.chips.map(ch => html`<button type="button" @click=${ch.pick} style="display: flex; align-items: center; gap: 4px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #E7E9EE; background: ${ch.bg}; border: 1px solid ${ch.border}; border-radius: 5px; padding: 2px 5px; cursor: pointer"><span style="width: 7px; height: 7px; border-radius: 50%; background: ${ch.colour}"></span>${ch.label}</button>`)}
</div>` : nothing}
</div>`)}
<button type="button" @click=${addField} style="align-self: flex-start; font-size: 11px; color: #9EC3FF; background: transparent; border: 1px dashed #3A4150; border-radius: 5px; padding: 4px 8px; cursor: pointer">+ Field</button>
</div>` : nothing}
${st.kind === 'alias' ? html`<span style="font-size: 12px; color: #A3AAB8">Brand of <b style="font-family: 'JetBrains Mono', monospace; color: #E7E9EE">${typeById[st.aliasFor!]!.name}</b>. Same data, but only joins with itself.</span>` : nothing}
${bd !== null ? html`<div style="display: flex; gap: 6px"><input type="text" aria-label="Brand name" .value=${live(bd.value)} @input=${(e: Event) => c.setState({ brandDraft: { ...bd, value: (e.target as HTMLInputElement).value } })} placeholder="Brand name, e.g. Email" style="flex: 1; min-width: 0; height: 30px; box-sizing: border-box; padding: 0 8px; background: #0D0F13; border: 1px solid #3A4150; border-radius: 6px; color: #E7E9EE; font-family: 'JetBrains Mono', monospace; font-size: 12px"><button type="button" @click=${() => c.saveBrand()} style="font-size: 12px; font-weight: 600; color: #0D0F13; background: #6FA8FF; border: 0; border-radius: 6px; padding: 0 10px; cursor: pointer">Copy</button></div>` : nothing}
<div style="display: flex; gap: 6px">
<button type="button" @click=${() => c.setState({ brandDraft: { sourceId: st.id, value: '' } })} style="flex: 1; height: 30px; font-size: 12px; color: #E7E9EE; background: transparent; border: 1px solid #3A4150; border-radius: 6px; cursor: pointer">Copy as brand</button>
${!st.builtIn ? html`<button type="button" @click=${() => c.removeType(st.id)} style="height: 30px; font-size: 12px; color: #FFB4A8; background: transparent; border: 1px solid #5A3A3A; border-radius: 6px; padding: 0 10px; cursor: pointer">Delete</button>` : nothing}
</div>
</div>`
}

/** The Types tab. */
export function renderTypesTab(c: PuzzlePort) {
  const s = c.s
  const m = s.model
  const typeById = byIdOf(m.types)
  const code = codeTabs(c)
  const typeDraft = draft(c, 'typeDraft', () => c.saveRecordType())
  const groupDefs: [string, (t: (typeof m.types)[number]) => boolean][] = [['BUILT-IN', t => t.builtIn], ['RECORDS', t => t.kind === 'record'], ['BRANDS', t => t.kind === 'alias']]
  const typeGroups = groupDefs.map(([title, pred]) => ({
    title,
    items: m.types.filter(pred).map(t => {
      const ic = iconFor(t.shape)
      const on = s.selectedType === t.id
      return {
        name: t.name,
        detail: t.kind === 'record' ? t.fields!.length + ' field' + (t.fields!.length === 1 ? '' : 's') : (t.kind === 'alias' ? 'brand of ' + typeById[t.aliasFor!]!.name : 'built-in'),
        bg: on ? '#212632' : 'transparent',
        border: on ? '#6FA8FF' : 'transparent',
        icon: { body: ic.body, knob: ic.knob, knobFill: t.colour, pattern: t.pattern === 'none' ? 'none' : 'url(#pat-' + t.pattern + ')' },
        select: () => c.setState({ selectedType: t.id, editorOpen: true, brandDraft: null, fieldPicker: null, panelErrors: [] })
      }
    })
  })).filter(g => g.items.length > 0)
  return html`<div style="display: flex; flex-direction: column; gap: 12px">
<div role="group" aria-label="Types view" style="display: flex; gap: 4px; border: 1px solid #2A303C; border-radius: 8px; padding: 3px">
<button type="button" aria-pressed=${code.listPressed} @click=${code.toList} style="flex: 1; font-size: 12px; color: #E7E9EE; background: ${code.listBg}; border: 0; border-radius: 6px; padding: 6px 0; cursor: pointer">List</button>
<button type="button" aria-pressed=${code.codePressed} @click=${code.toCode} style="flex: 1; font-size: 12px; color: #E7E9EE; background: ${code.codeBg}; border: 0; border-radius: 6px; padding: 6px 0; cursor: pointer">Code</button>
</div>
${typeDraft.open ? html`<div style="display: flex; gap: 6px"><input type="text" aria-label="New record type name" .value=${live(typeDraft.value)} @input=${typeDraft.onChange} placeholder="Record type name, e.g. Address" style="flex: 1; min-width: 0; height: 32px; box-sizing: border-box; padding: 0 8px; background: #0D0F13; border: 1px solid #3A4150; border-radius: 6px; color: #E7E9EE; font-family: 'JetBrains Mono', monospace; font-size: 12px"><button type="button" @click=${typeDraft.save} style="font-size: 12px; font-weight: 600; color: #0D0F13; background: #6FA8FF; border: 0; border-radius: 6px; padding: 0 12px; cursor: pointer">Create</button><button type="button" @click=${typeDraft.cancel} aria-label="Cancel" style="font-size: 12px; color: #A3AAB8; background: transparent; border: 1px solid #3A4150; border-radius: 6px; padding: 0 10px; cursor: pointer">✕</button></div>` : nothing}
${typeDraft.closed ? html`<button type="button" @click=${typeDraft.open_} style="height: 34px; font-size: 13px; font-weight: 600; color: #E7E9EE; background: transparent; border: 1px dashed #4A5263; border-radius: 8px; cursor: pointer">+ New record type</button>` : nothing}
${panelErrors(c)}

${typeGroups.map(tg => html`<div style="display: flex; flex-direction: column; gap: 2px">
<span style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #A3AAB8; padding: 6px 0">${tg.title}</span>
${tg.items.map(ty => html`<button type="button" @click=${ty.select} style="display: flex; align-items: center; gap: 10px; text-align: left; padding: 6px 8px; border-radius: 6px; background: ${ty.bg}; border: 1px solid ${ty.border}; color: #E7E9EE; cursor: pointer">
<svg width="30" height="26" viewBox="0 0 30 26" aria-hidden="true"><path d=${ty.icon.body} fill="#1A1E26" stroke="#4A5263" stroke-width="1"></path><path d=${ty.icon.knob} fill=${ty.icon.knobFill} stroke="#4A5263" stroke-width="0.8"></path><path d=${ty.icon.knob} fill=${ty.icon.pattern} stroke="none"></path></svg>
<span style="flex: 1; display: flex; flex-direction: column; gap: 1px"><span style="font-family: 'JetBrains Mono', monospace; font-size: 12px">${ty.name}</span><span style="font-size: 10px; color: #A3AAB8">${ty.detail}</span></span>
</button>`)}
</div>`)}

${renderDetail(c)}
</div>`
}
