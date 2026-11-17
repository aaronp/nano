import { Type } from 'typebox'
// A package as the template builds one: a rune component, its element, a catalog and define().
import { html } from 'lit'
import { component, state } from '@pritzlaff/nano-runes'
import { PlacedElement } from '@pritzlaff/nano-elements'

export const Dial = component('fixture.pkg2/dial', () => { const s = state({ ticks: 0 }); return { get ticks() { return s.ticks }, tick: () => { s.ticks += 1 } } }, { ticks: Type.Number({ description: 'Ticks so far' }), tick: { description: 'Adds a tick' } }, { description: 'A test dial' })
class DialEl extends PlacedElement { static component = Dial; render() { return html`<b>${this.read(Dial.ops.ticks) ?? 0}</b>` } }
export const catalog = { dial: { component: Dial, title: 'Dial', tag: 'fixture-dial' } }
export function define() { if (!customElements.get('fixture-dial')) customElements.define('fixture-dial', DialEl as unknown as CustomElementConstructor) }
