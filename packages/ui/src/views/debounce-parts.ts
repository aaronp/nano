// The debounce view's drawing: the switchback track, a batch bucket, and a slider with its elapsed bar (ported from the
// retired bundle's debounce element).
import { html } from 'lit'
import { bucketView, clamp01 } from './debounce-model.ts'

export const MONO = "'JetBrains Mono', ui-monospace, monospace"

/** A setting's slider: the value (shown while dragging), how much of it has elapsed, and `set` on release. */
export const slider = (name: string, aria: string, min: number, max: number, step: number, value: number, elapsed: number, color: string,
  drag: (v: number) => void, set: (v: number) => void, off?: { on: boolean; toggle: (on: boolean) => void }) => html`
  <label style="display:flex; flex-direction:column; gap:6px; width:180px">
    <span style="display:flex; justify-content:space-between"><span>${off ? html`<input type="checkbox" aria-label=${'Use ' + name} .checked=${off.on} @change=${(e: Event) => off.toggle((e.target as HTMLInputElement).checked)}> ` : ''}${name}</span><span style="color:var(--nano-fg, #E6EAF0)">${off && !off.on ? 'off' : `${Math.round(Math.min(elapsed, value))} / ${value} ms`}</span></span>
    <span style="display:block; height:6px; border-radius:3px; background:var(--nano-surface-2, #222933); overflow:hidden"><span style="display:block; height:6px; width:${off && !off.on ? 0 : Math.round(clamp01(elapsed / value) * 100)}%; background:${color}"></span></span>
    <input type="range" min=${min} max=${max} step=${step} .value=${String(value)} ?disabled=${off && !off.on} aria-label=${aria} style="width:180px; margin:0; accent-color:${color}"
      @input=${(e: Event) => drag(Number((e.target as HTMLInputElement).value))} @change=${(e: Event) => set(Number((e.target as HTMLInputElement).value))}>
  </label>`
/** The switchback track the queue runs along, from the entry at the top-left down to the hatch. */
export const track = () => html`
  <div style="position:absolute; left:100px; top:12px; width:80px; height:48px; border-radius:24px 0 0 24px; background:var(--nano-surface, #131820)"></div>
  <div style="position:absolute; left:114px; top:28px; font-family:${MONO}; font-size:12px; color:var(--nano-muted, #9AA4B2)">in →</div>
  <div style="position:absolute; left:164px; top:12px; width:974px; height:48px; border-radius:24px; background:var(--nano-surface-2, #161B22)"></div>
  <div style="position:absolute; left:1086px; top:36px; width:48px; height:70px; background:var(--nano-surface-2, #161B22)"></div>
  <div style="position:absolute; left:164px; top:82px; width:974px; height:48px; border-radius:24px; background:var(--nano-surface-2, #161B22)"></div>
  <div style="position:absolute; left:168px; top:106px; width:48px; height:70px; background:var(--nano-surface-2, #161B22)"></div>
  <div style="position:absolute; left:164px; top:152px; width:974px; height:48px; border-radius:24px; background:var(--nano-surface-2, #161B22)"></div>
  <div style="position:absolute; left:1082px; top:176px; width:56px; height:114px; background:var(--nano-surface-2, #161B22)"></div>`

/** A batch bucket: its count, its cells stacked from the bottom, and its id and reason underneath. The live one is
 * the bucket under the hatch. */
export function bucket(v: ReturnType<typeof bucketView>, left: number, opacity: number, id: string, reason: string, reasonColor: string, live: boolean, border = 'var(--nano-border, #2A313C)') {
  return html`<div class=${live ? 'live' : 'batch'} style="position:absolute; left:${left}px; top:0; width:122px; height:610px; opacity:${opacity}; pointer-events:none">
    ${v.n ? html`<div style="position:absolute; left:0; top:${v.countTop}px; width:122px; text-align:center; font-family:${MONO}; font-size:13px; color:var(--nano-fg, #E6EAF0)">${v.n}</div>` : ''}
    <div style="position:absolute; left:15px; top:290px; width:92px; height:270px; box-sizing:border-box; border:${live ? '2px solid ' + border : '1px ' + (v.solid ? 'solid' : 'dashed') + ' var(--nano-border, #2A313C)'}; border-top:none; border-radius:0 0 10px 10px; padding:${live ? 3 : 4}px; display:flex; flex-direction:column-reverse; gap:${v.gap}px; overflow:hidden${live ? '; background:var(--nano-surface, #12171E)' : ''}">
      ${v.cells.map(c => html`<div class="cell" style="flex:none; height:${c.h}px; box-sizing:border-box; border-radius:3px; background:${c.bg}; border:1px solid ${c.color}; color:${c.color}; display:flex; align-items:center; justify-content:center; font-family:${MONO}; font-size:10px; overflow:hidden">${c.text}</div>`)}
    </div>
    <div style="position:absolute; left:0; top:568px; width:122px; display:flex; flex-direction:column; align-items:center; gap:3px; font-family:${MONO}; font-size:12px">
      <span style="color:${live ? 'var(--nano-warn, #E8B04B)' : 'var(--nano-fg, #E6EAF0)'}">${id}</span><span style="color:${reasonColor}">${reason}</span>
    </div>
  </div>`
}
