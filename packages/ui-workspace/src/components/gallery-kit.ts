// The gallery's kit samples: pickers and inputs, overlays, data, and the agent pieces (@pritzlaff/nano-elements).
import { html } from 'lit';
import { toast, type Column, type MenuItem, type Span, type TestResults, type ToolPart } from '@pritzlaff/nano-elements';

const KINDS = ['range', 'input', 'log', 'map', 'filter', 'debounce'];
const GROUPED = [{ value: 'range', group: 'Inputs' }, { value: 'input', group: 'Inputs' }, { value: 'log', group: 'Outputs' }, { value: 'map', group: 'Transforms' },
  { value: 'filter', group: 'Transforms' }, { value: 'debounce', group: 'Transforms' }, { value: 'legacy', group: 'Transforms', disabled: true }];
const COMMANDS = [{ value: 'new', label: 'New workspace', group: 'Workspace', shortcut: '⌘N' }, { value: 'save', label: 'Save layout', group: 'Workspace', shortcut: '⌘S' },
  { value: 'theme', label: 'Change theme…', group: 'Settings' }, { value: 'import', label: 'Import a package…', group: 'Settings', shortcut: '⌘I' }];
/** Opens the <dialog> whose id is the button's data-open. */
const open = (e: Event) => { const b = e.currentTarget as HTMLElement; ((b.getRootNode() as ShadowRoot).querySelector(`#${b.dataset.open}`) as HTMLDialogElement | null)?.showModal?.(); };

export const pickers = () => html`<div class="sample col">
  <div class="kicker">Select</div>
  <div class="row"><nano-select placeholder="Kind" .options=${KINDS} .value=${'range'}></nano-select>
    <nano-select multiple placeholder="Kinds" .options=${GROUPED} .value=${['range', 'map']}></nano-select>
    <select aria-label="Native select"><option>Native select</option><option>log</option><option>map</option></select></div>
  <div class="kicker">Date</div>
  <div class="row" style="align-items:flex-start"><nano-date-picker .value=${'2026-11-10'}></nano-date-picker><div class="card" style="padding:0"><nano-calendar .value=${'2026-11-10'}></nano-calendar></div></div>
  <div class="kicker">Command</div>
  <div class="card" style="padding:0;max-width:420px"><nano-command placeholder="Type a command…" .items=${COMMANDS}></nano-command></div>
  <div class="kicker">Input group, toggles, switch</div>
  <div class="grid-auto">
    <div class="input-group"><span class="addon">⌕</span><input placeholder="Search components"><span class="addon"><span class="kbd">⌘K</span></span></div>
    <div class="input-group"><span class="addon">https://</span><input value="aaronp.github.io/nano"><button class="btn small">Copy</button></div>
    <div class="row"><button class="btn toggle" aria-pressed="true" @click=${press}>Wrap</button>
      <span class="toggle-group" role="group" aria-label="Text style"><button class="btn" aria-pressed="true" @click=${press}><b>B</b></button><button class="btn" aria-pressed="false" @click=${press}><i>I</i></button><button class="btn" aria-pressed="false" @click=${press}><u>U</u></button></span></div>
    <label class="row"><input type="checkbox" class="switch" checked> Live updates</label></div>
</div>`;
const press = (e: Event) => { const b = e.currentTarget as HTMLElement; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); };

const MENU: MenuItem[] = [{ heading: 'ex-range' }, { label: 'Rename', shortcut: '⌘R' }, { label: 'Duplicate', shortcut: '⌘D' }, { label: 'Connect…', disabled: true }, { separator: true }, { label: 'Delete', danger: true, shortcut: '⌫' }];
export const overlays = () => html`<div class="sample col">
  <div class="kicker">Dialog and drawer</div>
  <div class="row"><button class="btn primary" data-open="demo-dialog" @click=${open}>Open dialog</button><button class="btn" data-open="demo-drawer" @click=${open}>Open drawer</button>
    <button class="btn" data-open="demo-sheet" @click=${open}>Open bottom drawer</button><button class="btn" data-open="demo-command" @click=${open}>Command palette <span class="kbd">⌘K</span></button></div>
  <dialog class="dialog" id="demo-dialog"><header><h2>Rename component</h2><p>Connections keep working under the new name.</p></header>
    <label class="field">Name<input class="input" value="ex-range"></label>
    <form method="dialog"><footer><button class="btn">Cancel</button><button class="btn primary">Save</button></footer></form></dialog>
  <dialog class="drawer" id="demo-drawer"><header><h2>ex-range</h2><p>A range input, publishing its value.</p></header>
    <label class="field">Min<input class="input" value="0"></label><form method="dialog"><footer><button class="btn">Close</button></footer></form></dialog>
  <dialog class="drawer bottom" id="demo-sheet"><header><h2>Move goal</h2><p>Set your daily activity goal.</p></header><form method="dialog"><footer><button class="btn primary">Done</button></footer></form></dialog>
  <dialog class="dialog" id="demo-command" style="padding:0"><nano-command placeholder="Type a command…" .items=${COMMANDS}></nano-command></dialog>
  <div class="kicker">Hover card and context menu</div>
  <div class="row"><nano-hover-card><a href="#/components">@nano</a><div slot="card" class="row" style="align-items:flex-start;flex-wrap:nowrap">
      <span class="avatar">N</span><div class="col" style="gap:4px"><b>@nano</b><span>Small, composable components, with thin UIs any host can skin.</span><span class="muted">Since November 2026</span></div></div></nano-hover-card>
    <nano-menu .items=${MENU}><div class="card muted" style="border-style:dashed;padding:24px 40px">Right-click here</div></nano-menu></div>
  <div class="kicker">Toast</div>
  <div class="row"><button class="btn" data-toast @click=${() => toast('Layout saved', { description: 'Workspace “Main”, 4 panels.' })}>Show toast</button>
    <button class="btn" @click=${() => toast('Connected', { description: 'ex-range → ex-debounce', variant: 'good' })}>Good</button>
    <button class="btn" @click=${() => toast('Refused', { description: "number doesn't fit string", variant: 'bad' })}>Bad</button>
    <button class="btn" @click=${() => toast('Slow consumer', { description: 'ex-log is 3s behind', variant: 'warn' })}>Warn</button></div>
</div>`;

const ROWS = [{ name: 'ex-range', kind: 'range', status: 'running', events: 1204 }, { name: 'ex-debounce', kind: 'debounce', status: 'running', events: 87 },
  { name: 'ex-log', kind: 'log', status: 'idle', events: 87 }, { name: 'ex-input', kind: 'input', status: 'idle', events: 12 }, { name: 'ex-map', kind: 'map', status: 'failed', events: 12 },
  { name: 'timer-1', kind: 'timer', status: 'running', events: 5530 }, { name: 'notes', kind: 'notes', status: 'idle', events: 3 }];
const TONE: Record<string, string> = { running: 'good', failed: 'bad', idle: '' };
const COLUMNS: Column[] = [{ key: 'name', label: 'Name', sortable: true }, { key: 'kind', label: 'Kind', sortable: true },
  { key: 'status', label: 'Status', render: (r) => html`<span class="badge ${TONE[r.status as string]}">${r.status}</span>` }, { key: 'events', label: 'Events', sortable: true, align: 'right' }];
export const data = () => html`<div class="sample col">
  <div class="kicker">Data table</div>
  <nano-data-table filter selectable page-size="5" .columns=${COLUMNS} .rows=${ROWS}></nano-data-table>
  <div class="kicker">Avatars, badges, keys</div>
  <div class="row"><span class="avatar small">AP</span><span class="avatar">NC</span><span class="avatar large">RU</span>
    <span class="avatar-stack"><span class="avatar">AP</span><span class="avatar">CL</span><span class="avatar">+3</span></span>
    <span class="badge">default</span><span class="badge accent">new</span><span class="badge good">ok</span><span class="badge bad">failed</span>
    <span class="row" style="gap:2px"><span class="kbd">⌘</span><span class="kbd">⇧</span><span class="kbd">P</span></span></div>
  <div class="kicker">Messages</div>
  <div class="card col" style="max-width:520px"><div class="row" style="flex-wrap:nowrap;align-items:flex-end"><span class="avatar small">CL</span><div class="bubble">The range now feeds the debounce. Want the log batched too?</div></div>
    <div class="bubble mine">Yes, batch it every 300ms.</div><div class="row" style="flex-wrap:nowrap;align-items:flex-end"><span class="avatar small">CL</span><div class="bubble">Done: ex-debounce → ex-log.</div></div></div>
  <div class="kicker">Code block</div>
  <nano-code-block language="ts" .code=${"import { NanoSelect } from '@pritzlaff/nano-elements'\n\nselect.options = ['range', 'log', 'map']\nselect.addEventListener('change', () => console.log(select.value))"}></nano-code-block>
</div>`;

const TOOLS: ToolPart[] = [{ type: 'tool-read', state: 'output-available', input: { path: 'src/kit/select.ts' }, output: '115 lines' },
  { type: 'tool-grep', state: 'input-available', input: { pattern: 'customElements.define', path: 'src' } },
  { type: 'tool-bash', state: 'output-error', input: { command: 'bun test' }, errorText: '1 test failed: select multiple picks toggle values' },
  { type: 'tool-edit', state: 'input-streaming', input: { path: 'src/kit/' } }];
const SPANS: Span[] = [{ spanId: 'a', name: 'agent: theme the widgets', startTime: 0, endTime: 4200 }, { spanId: 'b', parentSpanId: 'a', name: 'llm: plan', startTime: 50, endTime: 900 },
  { spanId: 'c', parentSpanId: 'a', name: 'tool: read', startTime: 950, endTime: 1100 }, { spanId: 'd', parentSpanId: 'a', name: 'subagent: reviewer', startTime: 1150, endTime: 3900 },
  { spanId: 'e', parentSpanId: 'd', name: 'tool: grep', startTime: 1300, endTime: 1500 }, { spanId: 'f', parentSpanId: 'd', name: 'tool: bash', startTime: 1600, endTime: 3100, status: 'error' },
  { spanId: 'g', parentSpanId: 'd', name: 'llm: verdict', startTime: 3150, endTime: 3850 }];
const RESULTS: TestResults = { summary: { passed: 36, failed: 1, skipped: 1, total: 38, duration: 492 }, suites: [
  { name: 'select.test.ts', tests: [{ name: 'command: typing filters the items', status: 'passed', duration: 14 }, { name: 'select multiple: picks toggle values', status: 'failed', duration: 9, error: { message: 'expect(received).toEqual(expected)\n- ["range", "map"]\n+ ["range"]' } }] },
  { name: 'calendar.test.ts', tests: [{ name: 'shows the value\'s month', status: 'passed', duration: 6 }, { name: 'keyboard picks', status: 'skipped' }] }] };
export const agent = () => html`<div class="sample col">
  <div class="kicker">Subagent</div>
  <nano-subagent .agent=${{ name: 'code-reviewer', description: 'Review the kit branch', status: 'running', parts: TOOLS.slice(0, 2), result: 'Two findings so far; reading the overlays next.' }}></nano-subagent>
  <div class="kicker">Tool calls</div>
  <div class="col">${TOOLS.map((t) => html`<nano-tool .tool=${t}></nano-tool>`)}</div>
  <div class="kicker">Task</div>
  <nano-task .task=${{ title: 'Build the kit', items: [{ text: 'Style the native select', status: 'completed' }, { text: 'Filterable picker', status: 'completed', file: { name: 'select.ts' } },
    { text: 'Gallery tabs', status: 'in_progress', file: { name: 'gallery-kit.ts' } }, { text: 'Publish 0.2.0' }] }}></nano-task>
  <div class="kicker">CLI</div>
  <nano-cli .runs=${[{ command: 'bun test', cwd: 'packages/elements', output: ' 38 pass\n 0 fail\nRan 38 tests across 10 files. [492.00ms]', exitCode: 0 },
    { command: 'bunx tsc --noEmit -p .', output: "src/agent/parts.ts(32,11): error TS2416: Property 'part' …", exitCode: 2 }, { command: 'make dev', running: true }]}></nano-cli>
  <div class="kicker">Trace</div>
  <nano-trace .spans=${SPANS}></nano-trace>
  <div class="kicker">Test results</div>
  <nano-test-results .results=${RESULTS}></nano-test-results>
</div>`;

/** A few kit pieces, for the compare-themes columns. */
export const kitStrip = () => html`<div class="sample col" style="margin-top:12px">
  <div class="kicker">Kit</div>
  <div class="row"><nano-select placeholder="Kind" .options=${KINDS} .value=${'log'}></nano-select><input type="checkbox" class="switch" checked aria-label="Switch">
    <span class="avatar-stack"><span class="avatar small">AP</span><span class="avatar small">CL</span></span></div>
  <div class="bubble mine">Batch it every 300ms.</div>
  <nano-tool .tool=${TOOLS[2]}></nano-tool>
</div>`;
