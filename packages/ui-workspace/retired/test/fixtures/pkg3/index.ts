import { Type } from 'typebox'
// A package as the template builds one: a rune component, its element, a catalog and define().
import { html } from 'lit'
import { component, state } from '@pritzlaff/nano-runes'
import { PlacedElement } from '@pritzlaff/nano-elements'

export const Twin = component('fixture.pkg3/twin', () => { const s = state({ ticks: 0 }); return { get ticks() { return s.ticks }, tick: () => { s.ticks += 1 } } }, { ticks: Type.Number({ description: 'Ticks so far' }), tick: { description: 'Adds a tick' } }, { description: 'A test twin' })
class TwinEl extends PlacedElement { static component = Twin; render() { return html`<b>${this.read(Twin.ops.ticks) ?? 0}</b>` } }
export const catalog = { twin: { component: Twin, title: 'Twin', tag: 'fixture-twin' } }
export function define() { if (!customElements.get('fixture-twin')) customElements.define('fixture-twin', TwinEl as unknown as CustomElementConstructor) }
