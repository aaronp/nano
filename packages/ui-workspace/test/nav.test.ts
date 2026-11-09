// The shell marks the nav item for the page shown: a workspace sub-item too, but not an add-a-widget link.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'

await import('../src/components/app-shell.ts')
const tick = () => new Promise(r => setTimeout(r, 0))

test('on a workspace, its sub-item is the current page; add links never are', async () => {
  location.hash = '#/lab'
  document.body.innerHTML = `<app-shell>
    <div slot="nav" class="nav-row" data-workspaces><a href="#/workspace">Workspaces</a><button data-new-workspace>+</button></div>
    <a slot="nav" data-sub href="#/workspace">Main</a><a slot="nav" data-sub data-saved href="#/lab">Lab</a>
    <a slot="nav" data-sub href="#/lab" data-dock-add="x" data-widget="y">+ Y</a>
    <app-route path="/workspace"></app-route><app-route path="/lab"></app-route><app-route path="*"></app-route></app-shell>`
  const shell = document.querySelector('app-shell') as HTMLElement & { updateComplete: Promise<boolean> }
  await shell.updateComplete; await tick()
  const current = [...document.querySelectorAll('[aria-current="page"]')].map(a => a.textContent)
  expect(current).toEqual(['Lab'])
})

test('on Main, only the Main sub-item is current, not the Workspaces heading', async () => {
  location.hash = '#/workspace'; window.dispatchEvent(new HashChangeEvent('hashchange')); await tick()
  expect([...document.querySelectorAll('[aria-current="page"]')].map(a => a.textContent)).toEqual(['Main'])
})
