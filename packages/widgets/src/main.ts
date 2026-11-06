import { Contexts, type Factory } from '@composable/sdk'
import { mount } from '@composable/ui'
import { chart, counter, debug, log, mapped, mapper, push, setInput, setValue, slider, valueChanged } from '.'
import { defineElements } from './views'

defineElements()
const scope = Contexts.scope({ onError: (e, info) => console.error(e, info) })
const page = scope.context('page')
const place = async (name: string, factory: Factory, tag: string) =>
  mount(await scope.add(name, factory), tag, document.getElementById(name)!)

await place('log', log, 'flow-log')           // first, so it shows everything that follows
await place('slider', slider, 'flow-slider')
await place('doubler', mapper({ label: 'x × 2', from: valueChanged, fn: x => x * 2 }), 'flow-mapper')
await place('counter', counter({ every: 5, from: valueChanged }), 'flow-counter')
await place('chart', chart, 'flow-chart')
scope.route('doubler', mapped, 'chart', push)
void page.call('slider', setValue, 50)

await place('debug', debug, 'debug-panel')
document.querySelector('#hello')!.addEventListener('click', () => page.call('debug', setInput, 'hello from the page'))
