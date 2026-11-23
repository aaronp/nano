<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData } from 'vitepress'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { stripMarkers } from '../../scripts/playground/strip'
import { transpile } from '../../scripts/playground/transpile'
import { frameDoc, sharedBase } from '../../scripts/playground/frame'
import { accept } from '../../scripts/playground/messages'

const props = defineProps<{ step: string }>()
const { isDark, site } = useData()
const steps = import.meta.glob('../../../examples/tutorial/[0-9][0-9]-*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const original = stripMarkers(Object.entries(steps).find(([p]) => p.endsWith(`/${props.step}.ts`))?.[1] ?? '')
const key = `nano-docs.playground.${props.step}`
const host = ref<HTMLElement>(), frameHost = ref<HTMLElement>()
const lines = ref<{ text: string; err?: boolean }[]>([])
const theme = new Compartment()
let view: EditorView | undefined, frame: HTMLIFrameElement | undefined, run = '', timer: ReturnType<typeof setTimeout> | undefined, n = 0

const stored = () => { try { return localStorage.getItem(key) } catch { return null } }
const save = (v: string) => { try { v === original ? localStorage.removeItem(key) : localStorage.setItem(key, v) } catch {} }
const end = () => { clearTimeout(timer); run = ''; frame?.remove(); frame = undefined }
const say = (text: string, err = false) => lines.value.push({ text, err })

const onMessage = (e: MessageEvent) => {
  const m = frame && accept(e, frame.contentWindow, run)
  if (!m) return
  if (m.kind === 'line') return void say(m.text ?? '')
  if (m.kind === 'error') say(m.text?.startsWith('import failed') ? 'Build the host first: make ui (or cd packages/ui-workspace && bun run build).' : (m.text ?? 'Error'), true)
  end() // done, or the first error, ends the run
}

const go = () => {
  end()
  lines.value = []
  const t = transpile(view!.state.doc.toString())
  if (!t.ok) return say(t.error, true)
  run = `r${++n}`
  frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.title = `${props.step} output`
  frame.srcdoc = frameDoc(t.js, sharedBase(location.origin, site.value.base), run)
  frameHost.value!.append(frame)
  timer = setTimeout(() => { end(); say('Stopped: still running after 5 seconds.', true) }, 5000)
}
const reset = () => view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: original } })

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    doc: stored() ?? original,
    extensions: [
      basicSetup, javascript({ typescript: true }), theme.of(isDark.value ? oneDark : []),
      EditorView.contentAttributes.of({ 'aria-label': `${props.step} code` }),
      EditorView.updateListener.of(u => u.docChanged && save(u.state.doc.toString())),
      keymap.of([{ key: 'Mod-Enter', run: () => (go(), true) }]),
    ],
  })
  addEventListener('message', onMessage)
})
watch(isDark, d => view?.dispatch({ effects: theme.reconfigure(d ? oneDark : []) }))
onBeforeUnmount(() => { end(); removeEventListener('message', onMessage); view?.destroy() })
</script>

<template>
  <section class="playground" :aria-label="`${step} playground`">
    <div class="pg-bar"><button type="button" @click="go">Run</button><button type="button" @click="reset">Reset</button></div>
    <div ref="host" class="pg-editor" />
    <div ref="frameHost" />
    <pre class="pg-out" role="log" aria-live="polite"><div v-for="(l, i) in lines" :key="i" :class="{ err: l.err }">{{ l.text }}</div></pre>
  </section>
</template>
