import { Contexts, defineManifest, type UIComponent } from '@composable/sdk'
import { debug, setInput } from '.'

const root = Contexts.bus({
  self: { namespace: [], instance: 'root', manifest: defineManifest({ id: { author: 'composable', id: 'page' }, version: '0.1.0', emits: [], consumes: [] }) },
  onDeliveryError: e => console.error(e),
})
const inst = await root.register(debug, 'debug')
;(root.component(inst) as UIComponent).mount(document.querySelector('main')!)
document.querySelector('#hello')!.addEventListener('click', () => root.call(inst, setInput.name, 'hello from the page').then(console.log))
