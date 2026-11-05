import Type from 'typebox'
import { html } from 'lit'
import { Actions, Components, Events, defineManifest, type Context } from '@composable/sdk'
import { View, Widgets } from '@composable/sdk/lit'

export const submitted = Events.create('composable', 'submitted', Type.String())
export const setInput = Actions.declare('composable', 'set-input', Type.String())
const manifest = defineManifest({ id: { author: 'composable', id: 'text-emit' }, version: '0.1.0', emits: [submitted], consumes: [setInput] })

const logic = (ctx: Context) => {
  const state = { value: '' }
  return Object.assign(Components.create(manifest, { actions: [[setInput, (_c, v) => { state.value = v }]] }), {
    state, submit: () => ctx.emit(submitted, state.value),
  })
}

customElements.define('text-emit', class extends View<ReturnType<typeof logic>> {
  render() {
    const m = this.model
    return html`<form @submit=${(e: Event) => { e.preventDefault(); void m.submit() }}>
      <input aria-label="Message" .value=${m.state.value} @input=${(e: Event) => { m.state.value = (e.target as HTMLInputElement).value }}>
      <button>Send</button>
    </form>`
  }
})

export const textEmit = Widgets.view(manifest, 'text-emit', logic)
