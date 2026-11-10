import { Type } from 'typebox'
// A package as the template builds one: a rune component, its element, a catalog and define().
import { html } from 'lit'
import { component, state } from '@pritzlaff/nano-runes'
import { PlacedElement } from '@pritzlaff/nano-elements'

export const Clock = component('fixture.pkg/clock', () => { const s = state({ ticks: 0 }); return { get ticks() { return s.ticks }, tick: () => { s.ticks += 1 } } }, { ticks: Type.Number({ description: 'Ticks so far' }), tick: { description: 'Adds a tick' } }, { description: 'A test clock' })
class ClockEl extends PlacedElement { static component = Clock; render() { return html`<b>${this.read(Clock.ops.ticks) ?? 0}</b>` } }
export const catalog = { clock: { component: Clock, title: 'Clock', tag: 'fixture-clock' } }
export function define() { if (!customElements.get('fixture-clock')) customElements.define('fixture-clock', ClockEl as unknown as CustomElementConstructor) }
