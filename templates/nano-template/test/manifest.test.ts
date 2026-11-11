// The manifest a host reads before importing: the package, the shared packages it expects, and each component.
import { expect, test } from 'bun:test'
import { catalog } from '../src'
import { manifestOf } from '../src/manifest'

const pkg = {
  name: 'nano-template', version: '0.1.0',
  dependencies: { '@pritzlaff/nano-core': '^0.1.0', '@pritzlaff/nano-runes': '^0.1.0', '@pritzlaff/nano-elements': '^0.1.0', lit: '^3.0.0', typebox: '^1.4.0', 'left-pad': '^1.0.0' },
}

test('the manifest lists the package, the shared packages, and the Timer, Picker and Store with their ops', () => {
  const source = (name: string) => ({ name, input: false, output: true }), action = (name: string) => ({ name, input: true, output: true })
  expect(manifestOf(catalog, pkg)).toEqual({
    manifest: 1, name: 'nano-template', version: '0.1.0', module: './index.js',
    shared: { '@pritzlaff/nano-core': '^0.1.0', '@pritzlaff/nano-runes': '^0.1.0', '@pritzlaff/nano-elements': '^0.1.0', lit: '^3.0.0', typebox: '^1.4.0' },
    components: [{
      kind: 'timer', id: 'nano.template/timer', title: 'Timer', tag: 'nano-timer',
      ops: [source('count'), source('running'), source('interval'), source('tick'), action('start'), action('stop'), action('reset'), action('setInterval')],
    }, {
      kind: 'picker', id: 'nano.template/picker', title: 'Picker', tag: 'nano-picker',
      ops: [source('options'), source('value'), source('changed'), action('pick'), action('setOptions')],
    }, {
      kind: 'store', id: 'nano.template/store', title: 'Store', tag: 'nano-store',
      ops: [source('entries'), source('backing'), source('changed'), source('config'), action('configure'), action('get'), action('set'), action('remove')],
    }],
  })
})
