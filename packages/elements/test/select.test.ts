// <nano-command> (a filterable list) and <nano-select> (a picker over it, single or multiple).
import { expect, test } from 'bun:test'
import '../src'

type El = HTMLElement & { updateComplete: Promise<boolean>; [k: string]: any }
const tick = () => new Promise(r => setTimeout(r, 0))
const settle = async (...els: El[]) => { for (let i = 0; i < 3; i++) { for (const e of els) await e.updateComplete; await tick() } }
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true }))
const type = (input: HTMLInputElement, v: string) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true, composed: true })) }

const command = async (items: unknown[]) => {
  document.body.innerHTML = '<nano-command></nano-command>'
  const c = document.querySelector('nano-command') as El
  c.items = items; await settle(c)
  const input = c.shadowRoot!.querySelector('input')!
  const options = () => [...c.shadowRoot!.querySelectorAll('[role="option"]')] as HTMLElement[]
  return { c, input, options }
}

test('command: typing filters the items; arrows and Enter pick one', async () => {
  const { c, input, options } = await command([{ value: 'range', group: 'Inputs' }, { value: 'log', label: 'Log', group: 'Outputs', shortcut: '⌘L' }, { value: 'map', group: 'Outputs' }])
  expect(options().map(o => o.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['range', 'Log⌘L', 'map'])
  expect([...c.shadowRoot!.querySelectorAll('.menu-label')].map(l => l.textContent)).toEqual(['Inputs', 'Outputs'])
  let picked: any; c.addEventListener('pick', (e) => { picked = (e as CustomEvent).detail })
  type(input, 'a'); await settle(c)
  expect(options().map(o => o.dataset.value)).toEqual(['range', 'map'])
  key(input, 'ArrowDown'); await settle(c)
  expect(options()[1]!.classList.contains('active')).toBe(true)
  expect(input.getAttribute('aria-activedescendant')).toBe(options()[1]!.id)
  key(input, 'Enter')
  expect(picked.value).toBe('map')
  type(input, 'zzz'); await settle(c)
  expect(c.shadowRoot!.textContent).toContain('No results')
})

const select = async (attrs: string, value: unknown) => {
  document.body.innerHTML = `<nano-select ${attrs}></nano-select>`
  const s = document.querySelector('nano-select') as El
  s.options = ['range', 'log', 'map', { value: 'off', disabled: true }]; s.value = value; await settle(s)
  const trigger = s.shadowRoot!.querySelector('[role="combobox"]') as HTMLElement
  const cmd = () => s.shadowRoot!.querySelector('nano-command') as El
  const changes: unknown[] = []; s.addEventListener('change', () => changes.push(s.value))
  return { s, trigger, cmd, changes }
}

test('select: opens from its trigger, filters, and picks one value', async () => {
  const { s, trigger, cmd, changes } = await select('placeholder="Kind"', '')
  expect(trigger.textContent).toContain('Kind')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  key(trigger, 'ArrowDown'); await settle(s, cmd())
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  const input = cmd().shadowRoot!.querySelector('input')!
  type(input, 'lo'); await settle(s, cmd())
  key(input, 'Enter'); await settle(s, cmd())
  expect(s.value).toBe('log'); expect(changes).toEqual(['log'])
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(trigger.textContent).toContain('log')
})

test('select multiple: picks toggle values, shown as chips; Backspace drops the last; disabled ones are skipped', async () => {
  const { s, trigger, cmd, changes } = await select('multiple', ['range'])
  trigger.click(); await settle(s, cmd())
  const opt = (v: string) => cmd().shadowRoot!.querySelector(`[data-value="${v}"]`) as HTMLElement
  expect(opt('range').getAttribute('aria-selected')).toBe('true')
  opt('map').click(); await settle(s, cmd())
  opt('off').click(); await settle(s, cmd())
  expect(s.value).toEqual(['range', 'map'])
  expect(trigger.getAttribute('aria-expanded')).toBe('true')   // stays open to pick more
  expect([...s.shadowRoot!.querySelectorAll('.chip')].map(c => c.textContent!.replace('×', '').trim())).toEqual(['range', 'map'])
  key(trigger, 'Backspace'); await settle(s)
  expect(s.value).toEqual(['range'])
  expect(changes).toEqual([['range', 'map'], ['range']])
})
