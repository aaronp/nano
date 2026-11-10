// The agent pieces, display only, on the AI SDK / AI Elements data shapes: <nano-tool>, <nano-task>,
// <nano-subagent>, <nano-cli>, <nano-trace> (OpenTelemetry-style spans) and <nano-test-results>.
import { expect, test } from 'bun:test'
import '../src'

type El = HTMLElement & { updateComplete: Promise<boolean>; [k: string]: any }
const tick = () => new Promise(r => setTimeout(r, 0))
const mount = async (tag: string, prop: string, value: unknown) => {
  document.body.innerHTML = `<${tag}></${tag}>`
  const el = document.querySelector(tag) as El
  el[prop] = value
  for (let i = 0; i < 3; i++) { await el.updateComplete; await tick() }
  const $ = (s: string) => el.shadowRoot!.querySelector(s) as HTMLElement
  const $$ = (s: string) => [...el.shadowRoot!.querySelectorAll(s)] as HTMLElement[]
  return { el, $, $$ }
}

test('tool: its name and state; input and output; an error shows open, in red', async () => {
  const labels: Record<string, string> = { 'input-streaming': 'Pending', 'input-available': 'Running', 'output-available': 'Completed', 'output-error': 'Error' }
  for (const [state, label] of Object.entries(labels)) {
    const { $ } = await mount('nano-tool', 'tool', { type: 'tool-search', toolCallId: 'c1', state, input: { q: 'nano' } })
    expect($('.name').textContent).toBe('search'); expect($('.badge').textContent).toBe(label)
  }
  const ok = await mount('nano-tool', 'tool', { type: 'tool-search', state: 'output-available', input: { q: 'nano' }, output: { hits: 3 } })
  expect(ok.$('[data-part="input"]').textContent).toContain('"q": "nano"')
  expect(ok.$('[data-part="output"]').textContent).toContain('"hits": 3')
  expect(ok.$('details').hasAttribute('open')).toBe(false)
  const bad = await mount('nano-tool', 'tool', { type: 'dynamic-tool', toolName: 'fetch', state: 'output-error', input: {}, errorText: 'timeout' })
  expect(bad.$('.name').textContent).toBe('fetch')
  expect(bad.$('details').hasAttribute('open')).toBe(true)
  expect(bad.$('.alert.bad').textContent).toContain('timeout')
})

test('task: a title, its progress, and items by status', async () => {
  const { $, $$ } = await mount('nano-task', 'task', { title: 'Theme the widgets', items: [
    { text: 'Read the tokens', status: 'completed' }, { text: 'Map the themes', status: 'in_progress', file: { name: 'nano-vars.ts' } }, { text: 'Add the gallery' }] })
  expect($('.title').textContent).toBe('Theme the widgets'); expect($('.count').textContent).toBe('1/3')
  expect($$('li').map(l => l.dataset.status)).toEqual(['completed', 'in_progress', 'pending'])
  expect($('.file').textContent).toBe('nano-vars.ts')
})

test('subagent: its name, task and status, with its tool calls inside', async () => {
  const { $, $$ } = await mount('nano-subagent', 'agent', { name: 'code-reviewer', description: 'Review the branch', status: 'running',
    parts: [{ type: 'tool-read', state: 'output-available', input: { path: 'a.ts' }, output: 'ok' }, { type: 'tool-grep', state: 'input-available', input: { q: 'x' } }] })
  expect($('.name').textContent).toBe('code-reviewer'); expect($('.desc').textContent).toBe('Review the branch')
  expect($('.badge').textContent).toBe('Running'); expect($$('nano-tool').length).toBe(2)
})

test('cli: the command, its output and exit code', async () => {
  const { $$ } = await mount('nano-cli', 'runs', [{ command: 'bun test', output: '32 pass', exitCode: 0 }, { command: 'tsc', output: 'error TS1', exitCode: 2 }, { command: 'make dev', running: true }])
  expect($$('.cmd').map(c => c.textContent)).toEqual(['bun test', 'tsc', 'make dev'])
  expect($$('.exit').map(e => [e.textContent, e.classList.contains('good')])).toEqual([['exit 0', true], ['exit 2', false], ['running…', false]])
})

test('trace: spans as a timeline, children under parents, bars placed by time', async () => {
  const { $, $$ } = await mount('nano-trace', 'spans', [
    { spanId: 'b', parentSpanId: 'a', name: 'tool:read', startTime: 100, endTime: 300 },
    { spanId: 'a', name: 'agent', startTime: 0, endTime: 1000 },
    { spanId: 'c', parentSpanId: 'a', name: 'llm', startTime: 300, endTime: 800, status: 'error' },
    { spanId: 'd', parentSpanId: 'c', name: 'retry', startTime: 500, endTime: 800 }])
  const rows = $$('.span')
  expect(rows.map(r => [r.querySelector('.label')!.textContent!.trim(), r.dataset.depth])).toEqual([['agent', '0'], ['tool:read', '1'], ['llm', '1'], ['retry', '2']])
  const bar = rows[2]!.querySelector('.bar') as HTMLElement
  expect(bar.style.left).toBe('30%'); expect(bar.style.width).toBe('50%'); expect(bar.classList.contains('bad')).toBe(true)
  expect(rows[1]!.querySelector('.dur')!.textContent).toBe('200ms')
  expect($('.total').textContent).toBe('1.00s')
})

test('test results: the summary, a bar per outcome, and failing tests with their errors', async () => {
  const { $, $$ } = await mount('nano-test-results', 'results', {
    summary: { passed: 6, failed: 1, skipped: 1, total: 8, duration: 1234 },
    suites: [{ name: 'select', tests: [{ name: 'filters', status: 'passed', duration: 12 }, { name: 'picks', status: 'failed', duration: 30, error: { message: 'expected log' } }] },
      { name: 'calendar', tests: [{ name: 'grid', status: 'skipped' }] }] })
  expect($('[data-count="passed"]').textContent).toContain('6'); expect($('[data-count="failed"]').textContent).toContain('1')
  expect($('.dur').textContent).toBe('1.23s')
  expect(($('.seg.passed') as HTMLElement).style.width).toBe('75%')
  expect($$('details.suite').map(s => s.hasAttribute('open'))).toEqual([true, false])   // a suite with a failure opens
  expect($('.test.failed .alert.bad').textContent).toContain('expected log')
})
