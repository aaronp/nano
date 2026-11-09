// The demo: an editor in a registry, seeded with slider, doubler, chart, meter and log.
import { Registries, Runtimes } from '@composable/core'
import { addEditor } from '../src'
import { defineElements, type EditorPage } from '../src/elements'
import { seed } from './seed'

defineElements()
const rt = Runtimes.create(Registries.create('demo')), ids = addEditor(rt.registry)
await seed(rt, ids)
const page = document.querySelector('editor-page') as EditorPage
page.registry = rt.registry
page.ids = ids
