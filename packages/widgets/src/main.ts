import { Scopes, type ComponentFactory } from '@composable/sdk'
import { applyTheme, mount, themes } from '@composable/ui'
import { chart, count, counter, debug, log, mapIn, mapped, mapper, push, setInput, setValue, slider, valueChanged } from '.'
import { defineElements } from './views'

defineElements()
const pick = document.querySelector<HTMLSelectElement>('#theme')!
const theme = (name: keyof typeof themes) => { pick.value = name; applyTheme(document.documentElement, themes[name]) }
theme(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
pick.addEventListener('change', () => theme(pick.value as keyof typeof themes))
const scope = Scopes.create({ onError: (e, info) => console.error(e, info) })
const page = scope.context('page')
const place = async (name: string, factory: ComponentFactory, tag: string) =>
  mount(await scope.add(name, factory), tag, document.getElementById(name)!)

await place('log', log, 'flow-log')           // first, so it shows everything that follows
await place('slider', slider, 'flow-slider')
await place('doubler', mapper({ label: 'x × 2', fn: x => x * 2 }), 'flow-mapper')
await place('counter', counter({ every: 5 }), 'flow-counter')
await place('chart', chart, 'flow-chart')
// The wiring: publications into subscriptions.
scope.route('slider', valueChanged, 'doubler', mapIn)
scope.route('slider', valueChanged, 'counter', count)
scope.route('doubler', mapped, 'chart', push)
void page.call('slider', setValue, 50)

await place('debug', debug, 'debug-panel')
document.querySelector('#hello')!.addEventListener('click', () => page.call('debug', setInput, 'hello from the page'))
