// The "Types as TypeScript" overlay: edit the types as source, see what applying would do, apply or revert.
import { html, nothing } from 'lit'
import { live } from 'lit/directives/live.js'
import { modelToTs, planTs } from './ts-view'
import type { PuzzlePort } from './puzzle-port'
import { codeTabs } from './render-types'

/** The code overlay, while the Types tab is in Code view. */
export function renderCode(c: PuzzlePort) {
  const s = c.s
  if (!(s.codeOpen && s.tab === 'types')) return nothing
  const plan = planTs(s.model, s.codeText)
  const code = {
    ...codeTabs(c),
    summary: plan.ok ? plan.summary : plan.errors.length + ' problem' + (plan.errors.length === 1 ? '' : 's') + ' to fix',
    summaryColour: plan.ok ? '#7CE3A1' : '#FF8A80',
    applyBg: plan.ok ? '#6FA8FF' : '#4A5263',
    revert: () => c.setState({ codeText: modelToTs(s.model.types), codeMessage: 'Reverted to the current types.' })
  }
  return html`<div style="position: absolute; left: 0; top: 0; width: 1120px; height: 900px; background: rgba(13, 15, 19, 0.82); z-index: 60"></div>
<div style="position: absolute; left: 60px; top: 60px; width: 1000px; height: 780px; box-sizing: border-box; background: #14171D; border: 1px solid #3A4150; border-radius: 14px; padding: 22px 24px; display: flex; flex-direction: column; gap: 14px; z-index: 61; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6)">
<div style="display: flex; align-items: center; gap: 10px"><span style="font-size: 18px; font-weight: 700">Types as TypeScript</span><span style="flex: 1"></span>
<button type="button" @click=${code.revert} style="font-size: 12px; color: #E7E9EE; background: transparent; border: 1px solid #3A4150; border-radius: 6px; padding: 7px 12px; cursor: pointer">Revert</button>
<button type="button" @click=${() => c.applyCode()} style="font-size: 12px; font-weight: 600; color: #0D0F13; background: ${code.applyBg}; border: 0; border-radius: 6px; padding: 7px 14px; cursor: pointer">Apply</button>
<button type="button" @click=${code.toList} style="font-size: 12px; font-weight: 600; color: #0D0F13; background: #E7E9EE; border: 0; border-radius: 6px; padding: 7px 14px; cursor: pointer">Done</button></div>
<div style="flex: 1; display: flex; gap: 20px; min-height: 0">
<textarea aria-label="TypeScript types" spellcheck="false" .value=${live(s.codeText)} @input=${(e: Event) => c.setState({ codeText: (e.target as HTMLTextAreaElement).value, codeMessage: '' })} style="width: 600px; height: 100%; box-sizing: border-box; padding: 14px; background: #0D0F13; border: 1px solid #2A303C; border-radius: 10px; color: #E7E9EE; font-family: 'JetBrains Mono', monospace; font-size: 13px; line-height: 20px; resize: none; user-select: text; tab-size: 2"></textarea>
<div style="flex: 1; display: flex; flex-direction: column; gap: 12px; overflow-y: auto">
<span style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #A3AAB8">IF YOU APPLY</span>
<span style="font-size: 13px; color: ${code.summaryColour}">${code.summary}</span>
${plan.errors.map(text => html`<span style="font-family: 'JetBrains Mono', monospace; font-size: 11px; line-height: 16px; color: #FF8A80">${text}</span>`)}
<span style="font-size: 12px; color: #F5CF5B">${s.codeMessage}</span>
<div style="border-top: 1px solid #2A303C; padding-top: 12px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; line-height: 18px; color: #A3AAB8">
<span style="font-size: 11px; font-weight: 600; letter-spacing: 0.08em">WHAT IT UNDERSTANDS</span>
<span style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #C9CED8; white-space: pre">interface Address {
  street: string;
  tags: string[];
}
type Point = { x: number; y: number };
type Email = string;   // a brand of string</span>
<span>Fields take a named type, <span style="font-family: 'JetBrains Mono', monospace">T[]</span> or <span style="font-family: 'JetBrains Mono', monospace">Array&lt;T&gt;</span>. <span style="font-family: 'JetBrains Mono', monospace">type X = Y</span> makes X a brand of Y. Removing a type that an action uses is refused.</span>
<span>New or changed types get a shape and colour from the SHA-256 of their definition, unless you have customised the shape.</span>
</div>
</div>
</div>
</div>`
}
