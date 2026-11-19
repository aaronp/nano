/**
 * The workspace's `<nano-explorer>` icon renderer and the kind icons and status dots it draws.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator'
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register()
import { expect, test } from 'bun:test'

const { render } = await import('lit')
const { icon, kindIcon, statusDot } = await import('../src/icons.ts')

test('kindIcon and statusDot render an svg with a title per kind and status', () => {
  const host = document.createElement('div')
  for (const k of ['pod', 'interface', 'implementation', 'action', 'event', 'runtime', 'other']) {
    render(kindIcon(k) as never, host)
    expect(host.querySelector('svg title')!.textContent).toBe(k)
  }
  for (const s of ['running', 'not started', 'stopped', 'failed'] as const) {
    render(statusDot(s) as never, host)
    expect(host.querySelector('svg title')!.textContent).toBe(s)
  }
})

test('the workspace renderer: a pod shows its status dot and hexagon; a group none; the rest their kind icon', () => {
  const host = document.createElement('div')
  render(icon({ id: 'p', label: 'p', kind: 'pod', data: { status: 'failed' } }) as never, host)
  expect([...host.querySelectorAll('svg')].map(s => s.getAttribute('aria-label'))).toEqual(['failed', 'pod'])
  render(icon({ id: 'i', label: 'i', kind: 'interface' }) as never, host)
  expect([...host.querySelectorAll('svg')].map(s => s.getAttribute('aria-label'))).toEqual(['interface'])
  expect(icon({ id: 'g', label: 'g' })).toBeUndefined()
})
