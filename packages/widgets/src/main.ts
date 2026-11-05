import { Contexts, defineManifest } from '@composable/sdk'
import { mount } from '@composable/ui'
import { debug, setInput } from '.'
import { defineElements } from './views'

defineElements()
const root = Contexts.registry({
  self: { namespace: [], instance: 'root', manifest: defineManifest({ id: { author: 'composable', id: 'page' }, version: '0.1.0', emits: [], consumes: [] }) },
  onDeliveryError: e => console.error(e),
})
const inst = await root.register(debug, 'debug')
mount(root.component(inst)!, 'debug-panel', document.querySelector('main')!)
document.querySelector('#hello')!.addEventListener('click', () => root.call(inst, setInput, 'hello from the page').then(console.log))
