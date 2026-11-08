import { Components, Systems, type ComponentFactory } from '@composable/sdk'
import { applyTheme, mount, themes } from '@composable/ui'
import { chart, count, counter, debug, log, mapNumber, mapper, push, setInput, setValue, slider, valueChanged } from '.'
import { defineElements } from './views'

defineElements()
const pick = document.querySelector<HTMLSelectElement>('#theme')!
const theme = (name: keyof typeof themes) => { pick.value = name; applyTheme(document.documentElement, themes[name]) }
theme(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
pick.addEventListener('change', () => theme(pick.value as keyof typeof themes))
const scope = Systems.create({ onError: (e, info) => console.error(e, info) })
const page = scope.register('page', Components.party())
const place = async (name: string, factory: ComponentFactory, tag: string) => {
  const c = await factory.create()
  scope.register(name, c)
  mount(c, tag, document.getElementById(name)!)
}

await place('log', log, 'flow-log')           // first, so it shows everything that follows
await place('slider', slider, 'flow-slider')
await place('doubler', mapper({ label: 'x × 2', fn: x => x * 2 }), 'flow-mapper')
await place('counter', counter({ every: 5 }), 'flow-counter')
await place('chart', chart, 'flow-chart')
// The wiring: publications into subscriptions.
scope.connect('slider', valueChanged, 'doubler', mapNumber)
scope.connect('slider', valueChanged, 'counter', count)
scope.connect('doubler', mapNumber, 'chart', push)   // the action's outcome
void page.call('slider', setValue, 50)

await place('debug', debug, 'debug-panel')
document.querySelector('#hello')!.addEventListener('click', () => page.call('debug', setInput, 'hello from the page'))
