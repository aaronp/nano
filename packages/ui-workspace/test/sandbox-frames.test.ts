// Frames: the iframe's srcdoc, the layer and openFrame, and <c-sandboxed> placing a frame. happy-dom runs no iframe content.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { afterEach, expect, test } from 'bun:test'

const { Components, Registries, Runtimes } = await import('@pritzlaff/nano-core')
const { provide } = await import('@pritzlaff/nano-elements')
const { READY_MS, srcdoc, openFrame, layer } = await import('../src/sandbox/frames')
const { defineSandboxed } = await import('../src/sandbox/sandboxed-el')
const { standIn } = await import('../src/sandbox/stand-in')
defineSandboxed()
;(window as any).happyDOM.setURL("https://h.test/app/"); (window as any).happyDOM.settings.handleDisabledFileLoadingAsSuccess = true   // the iframes are not run

afterEach(() => { document.body.innerHTML = '' })
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
const opts = { url: 'https://x.test/p.js', kind: 'k', render: true }

test('srcdoc carries the host import map with absolute URLs and loads boot by absolute URL', () => {
  const html = srcdoc({ imports: { lit: './shared/lit.js', a: 'https://cdn.test/a.js' } }, 'https://h.test/app/sandbox/boot.js', 'https://h.test/app/')
  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)![1]!)
  expect(map.imports).toEqual({ lit: 'https://h.test/app/shared/lit.js', a: 'https://cdn.test/a.js' })
  expect(html).toContain('<script type="module" src="https://h.test/app/sandbox/boot.js"></script>')
  expect(srcdoc({ imports: { x: '</script><b>' } }, 'https://h.test/b.js', 'https://h.test/')).not.toContain('</script><b>')
})

test('openFrame sets sandbox to the mode\'s attribute', () => {
  expect(openFrame({ ...opts, mode: 'sandbox' }).element!.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
  expect(openFrame({ ...opts, mode: 'isolated-sandbox' }).element!.getAttribute('sandbox')).toBe('allow-scripts')
})

test('ready rejects after the time with no answer, and resolves on the iframe\'s ready', async () => {
  expect(READY_MS).toBe(10_000)
  const f = openFrame({ ...opts, mode: 'sandbox', readyMs: 5 })
  await expect(f.ready).rejects.toThrow(/did not answer/)
  const ch = new MessageChannel()
  const g = openFrame({ ...opts, mode: 'sandbox', readyMs: 1000, channel: ch })
  ch.port2.postMessage({ type: 'ready' })
  await g.ready
  g.dispose(); ch.port2.close()
})

test('a frame lives in the layer; moving its <c-sandboxed> never moves the iframe node', async () => {
  const f = openFrame({ ...opts, mode: 'sandbox' })
  expect(f.element!.parentElement).toBe(layer(document))
  expect(document.body.lastElementChild).toBe(layer(document))
  const { rt } = world(f)
  provide(document, rt.registry)
  const a = document.createElement('div'), b = document.createElement('div')
  document.body.append(a, b)
  const el = document.createElement('c-sandboxed'); el.setAttribute('name', 'box')
  a.append(el); await tick()
  const node = f.element!, parent = node.parentElement
  expect(node.style.display).not.toBe('none')
  b.append(el); await tick()
  expect(f.element).toBe(node); expect(node.parentElement).toBe(parent)
  f.dispose()
})

test('<c-sandboxed> hides its frame when disconnected and shows "shown elsewhere" for a second element', async () => {
  const f = openFrame({ ...opts, mode: 'sandbox' })
  provide(document, world(f).rt.registry)
  const one = document.createElement('c-sandboxed'), two = document.createElement('c-sandboxed')
  one.setAttribute('name', 'box'); two.setAttribute('name', 'box')
  document.body.append(one, two); await tick()
  expect((two as any).shadowRoot.textContent).toContain('shown elsewhere')
  expect((one as any).shadowRoot.textContent).not.toContain('shown elsewhere')
  expect(f.element!.style.display).not.toBe('none')
  one.remove(); await tick()
  expect(f.element!.style.display).toBe('none')
  f.dispose()
})

test('<c-sandboxed> shows the error of a frame that failed', async () => {
  const f = openFrame({ ...opts, mode: 'sandbox', readyMs: 5 })
  f.ready.catch(() => {})
  provide(document, world(f).rt.registry)
  const el = document.createElement('c-sandboxed'); el.setAttribute('name', 'box')
  document.body.append(el); await tick(30)
  expect((el as any).shadowRoot.textContent).toContain('did not answer')
  f.dispose()
})

test('removing the instance from its last registry disposes the frame; from one of two, not', async () => {
  let disposed = 0
  const f = { ...openFrame({ ...opts, mode: 'sandbox' }), dispose() { disposed++ } }
  const c = standIn({ id: { ns: 't', name: 'thing' }, title: 'T', ops: [] }, () => f)
  const a = Runtimes.create(Registries.create('a')), b = Runtimes.create(Registries.create('b'))
  const inst = Components.instantiate(c)
  a.registry.add('box', inst); b.registry.add('box', inst)
  a.registry.remove('box')
  expect(disposed).toBe(0)
  b.registry.remove('box')
  expect(disposed).toBe(1)
})

function world(f: ReturnType<typeof openFrame>) {
  const rt = Runtimes.create(Registries.create('h'))
  rt.registry.add('box', Components.instantiate(standIn({ id: { ns: 't', name: 'thing' }, title: 'T', ops: [] }, () => f)))
  return { rt }
}
