// <nano-data-table>: columns and rows; sorting, a filter, row selection and pages.
import { expect, test } from 'bun:test'
import '../src'

type El = HTMLElement & { updateComplete: Promise<boolean>; [k: string]: any }
const tick = () => new Promise(r => setTimeout(r, 0))
const settle = async (el: El) => { for (let i = 0; i < 3; i++) { await el.updateComplete; await tick() } }
const ROWS = [
  { name: 'ex-range', status: 'running', amount: 30 }, { name: 'ex-log', status: 'idle', amount: 5 }, { name: 'ex-map', status: 'running', amount: 12 },
  { name: 'ex-input', status: 'pending', amount: 50 }, { name: 'ex-debounce', status: 'idle', amount: 1 },
]

const table = async (attrs = '') => {
  document.body.innerHTML = `<nano-data-table ${attrs}></nano-data-table>`
  const d = document.querySelector('nano-data-table') as El
  d.columns = [{ key: 'name', label: 'Name', sortable: true }, { key: 'status', label: 'Status' }, { key: 'amount', label: 'Amount', sortable: true, align: 'right' }]
  d.rows = ROWS; await settle(d)
  const $ = (s: string) => d.shadowRoot!.querySelector(s) as HTMLElement
  const names = () => [...d.shadowRoot!.querySelectorAll('tbody tr')].map(r => r.querySelector('[data-key="name"]')?.textContent)
  return { d, $, names }
}

test('sorts by a sortable column, ascending then descending', async () => {
  const { d, $, names } = await table()
  expect(names()).toEqual(ROWS.map(r => r.name))
  expect($('th[data-key="status"] button')).toBeNull()
  $('th[data-key="amount"] button').click(); await settle(d)
  expect(names()).toEqual(['ex-debounce', 'ex-log', 'ex-map', 'ex-range', 'ex-input'])
  expect($('th[data-key="amount"]').getAttribute('aria-sort')).toBe('ascending')
  $('th[data-key="amount"] button').click(); await settle(d)
  expect(names()[0]).toBe('ex-input')
  expect($('th[data-key="amount"]').getAttribute('aria-sort')).toBe('descending')
})

test('the filter keeps rows with a cell containing the text', async () => {
  const { d, $, names } = await table('filter')
  const input = $('input.filter') as HTMLInputElement
  input.value = 'RUN'; input.dispatchEvent(new Event('input')); await settle(d)
  expect(names()).toEqual(['ex-range', 'ex-map'])
  input.value = 'nothing'; input.dispatchEvent(new Event('input')); await settle(d)
  expect(d.shadowRoot!.textContent).toContain('No results.')
})

test('selectable: rows and select-all; emits the selected rows; the footer counts them', async () => {
  const { d, $ } = await table('selectable')
  const seen: unknown[][] = []; d.addEventListener('selection', (e) => seen.push((e as CustomEvent).detail))
  const boxes = () => [...d.shadowRoot!.querySelectorAll('tbody input[type="checkbox"]')] as HTMLInputElement[]
  boxes()[0]!.click(); boxes()[2]!.click(); await settle(d)
  expect(seen.at(-1)).toEqual([ROWS[0], ROWS[2]])
  expect($('.foot').textContent).toContain('2 of 5 row(s) selected.')
  ;($('thead input[type="checkbox"]') as HTMLInputElement).click(); await settle(d)
  expect(seen.at(-1)!.length).toBe(5)
})

test('page-size splits rows into pages', async () => {
  const { d, $, names } = await table('page-size="2"')
  expect(names()).toEqual(['ex-range', 'ex-log'])
  expect($('.pages').textContent).toContain('Page 1 of 3')
  expect(($('[aria-label="Previous page"]') as HTMLButtonElement).disabled).toBe(true)
  $('[aria-label="Next page"]').click(); await settle(d)
  expect(names()).toEqual(['ex-map', 'ex-input'])
})
