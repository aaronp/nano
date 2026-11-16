// The shell: hash routes in <app-shell>, the app bar's title and menus, Settings' reset.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'

await import('../src/shell/app-shell.ts')
const { hostUi } = await import('../src/host-ui.ts')
await import('../src/shell/app-bar.ts')
const { forgetLayout } = await import('../src/shell/settings.ts')

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))
async function mount() {
  document.body.innerHTML = `<app-shell><a slot="nav" href="#/workspace">Workspace</a><a slot="nav" href="#/themes">Themes</a>
    <app-route path="/workspace">w</app-route><app-route path="/themes">t</app-route><app-route path="*">nf</app-route></app-shell>`
  const shell = document.querySelector('app-shell') as HTMLElement & { updateComplete: Promise<unknown> }
  await shell.updateComplete
  return () => [...document.querySelectorAll('app-route')].filter(r => !(r as HTMLElement).hidden).map(r => r.getAttribute('path'))
}

test('given the hash #/themes, then only the themes route shows; an unknown hash shows *; none shows the first', async () => {
  const shown = await mount()
  expect(shown()).toEqual(['/workspace'])
  location.hash = '#/themes'; await tick(5)
  expect(shown()).toEqual(['/themes'])
  expect(document.querySelector('a[href="#/themes"]')!.getAttribute('aria-current')).toBe('page')
  location.hash = '#/nowhere'; await tick(5)
  expect(shown()).toEqual(['*'])
  location.hash = ''
})

test('given setAppBar was last called with a text, then the app bar shows it; File > Save fires nano-command save', async () => {
  const bar = document.body.appendChild(document.createElement('workspace-app-bar')) as HTMLElement & { updateComplete: Promise<unknown> }
  await bar.updateComplete
  const handlers = await hostUi.make({} as never, undefined)
  await (handlers.get([...handlers.keys()].find(k => k.endsWith('setAppBar'))!) as (a: unknown) => Promise<unknown>)('My app')
  await bar.updateComplete
  expect(bar.shadowRoot!.querySelector('.title')!.textContent).toBe('My app')
  const sent: string[] = []
  bar.addEventListener('nano-command', e => sent.push((e as CustomEvent<string>).detail))
  const file = bar.shadowRoot!.querySelector('nano-menu')!
  file.dispatchEvent(new CustomEvent('pick', { detail: { label: 'Save', value: 'save' }, bubbles: true, composed: true }))
  expect(sent).toEqual(['save'])
})

test('given pane sizes saved, then forgetting the layout clears the split keys and nothing else', () => {
  localStorage.setItem('split:workspace', '[1]'); localStorage.setItem('other', 'x')
  forgetLayout()
  expect(localStorage.getItem('split:workspace')).toBeNull()
  expect(localStorage.getItem('other')).toBe('x')
})
