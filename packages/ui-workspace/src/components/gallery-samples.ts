// The gallery's samples: every class in the component library (@pritzlaff/nano-elements' `base`), the type and
// colour tokens, and the same content in the layouts a widget is likely to sit in.
import { html, svg } from 'lit';
import { NANO_TOKENS, tv, type NanoToken } from '@pritzlaff/nano-elements';

/** Buttons, labels, containers, forms and data, in their variants and states. */
export const primitives = () => html`<div class="sample col">
  <div class="kicker">Buttons</div>
  <div class="row"><button class="btn primary">Primary</button><button class="btn">Default</button><button class="btn danger">Danger</button>
    <button class="btn dashed">+ Dashed</button><button class="btn small">Small</button><button class="btn" disabled>Disabled</button>
    <button class="btn" aria-pressed="true">Pressed</button><button class="icon-btn" aria-label="Close">✕</button></div>
  <div class="kicker">Labels</div>
  <div class="row"><span class="badge">neutral</span><span class="badge good">accepted</span><span class="badge bad">rejected</span>
    <span class="badge warn">revisit</span><span class="badge accent">new</span><span class="chip">#infra</span><span class="chip">#data</span>
    <span class="pill" style="color:${tv('good')}">running</span><span class="pill" style="color:${tv('muted')}">idle</span></div>
  <div class="kicker">Containers and states</div>
  <div class="grid-auto"><div class="card"><b>Card</b><p class="muted">A surface with a border.</p></div>
    <div class="alert good">Saved: 3 connections made.</div><div class="alert bad">Refused: number doesn't fit string.</div><div class="alert">A plain notice.</div></div>
  <div class="kicker">Forms</div>
  <div class="grid-auto"><label class="field">Name<input class="input" value="ex-range"></label>
    <label class="field">Kind<select><option>range</option><option>log</option></select></label>
    <label class="field">Quiet (ms)<input type="range" min="0" max="100" value="40"></label>
    <label class="field">Progress<div class="meter"><span style="width:62%"></span></div></label>
    <label class="field">Notes<textarea rows="2">Debounce before the log.</textarea></label>
    <label class="row"><input type="checkbox" checked> Keep when closed</label></div>
  <div class="kicker">Data</div>
  <div class="tabs" role="tablist"><button role="tab" aria-selected="true">Overview</button><button role="tab" aria-selected="false">Ops</button><button role="tab" aria-selected="false">Connections</button></div>
  ${table()}
  <p class="problem">A problem line, as elements show a refusal.</p>
</div>`;

const table = () => html`<table class="table"><thead><tr><th>Component</th><th>Kind</th><th>Status</th></tr></thead><tbody>
  <tr><td class="mono">ex-range</td><td>range</td><td><span class="badge good">wired</span></td></tr>
  <tr><td class="mono">ex-debounce</td><td>debounce</td><td><span class="badge good">wired</span></td></tr>
  <tr><td class="mono">ex-map</td><td>map</td><td><span class="badge warn">no output</span></td></tr></tbody></table>`;

/** The display scale, and a swatch per colour token. */
export const typeAndColour = () => html`<div class="sample col">
  <p class="kicker">Kicker</p><h1 class="display-l">Display large</h1><h2 class="display-m">Display medium</h2><h3 class="display-s">Display small</h3>
  <p>Body text in the host's font. <span class="muted">Muted text.</span> <span class="mono">mono · composable.bundle/range/set</span></p>
  <div class="grid-auto">${(Object.keys(NANO_TOKENS) as NanoToken[]).filter((k) => !/^(font|radius)/.test(k)).map((k) => html`
    <div class="swatch card row"><span style="width:28px; height:28px; border-radius:${tv('radius-s')}; border:1px solid ${tv('border')}; background:${tv(k)}"></span><span class="mono">--nano-${k}</span></div>`)}</div>
</div>`;

const stat = (label: string, value: string, delta: string, good: boolean) => html`<div class="card col"><span class="kicker">${label}</span>
  <span class="display-m">${value}</span><span class="badge ${good ? 'good' : 'bad'}">${delta}</span></div>`;
const bars = () => svg`<svg viewBox="0 0 240 90" width="100%" height="90" role="img" aria-label="Messages per minute">
  ${[38, 62, 45, 80, 57, 70, 30, 66].map((h, i) => svg`<rect x=${i * 30 + 4} y=${90 - h} width="22" height=${h} rx="3" style="fill:${tv(`s${(i % 8) + 1}` as NanoToken)}"></rect>`)}</svg>`;

/** The same content as a card grid, a list, a form, a dashboard row and a table. */
export const layouts = () => html`<div class="sample col">
  <section data-layout="cards" class="col"><h3 class="display-s">Card grid</h3><div class="grid-auto">
    ${['Range', 'Debounce', 'Log', 'Map'].map((n, i) => html`<div class="card col"><span class="kicker">component</span><b>${n}</b>
      <span class="muted">${['emits value', 'batches events', 'keeps entries', 'transforms x'][i]}</span><div class="row"><button class="btn small">Open</button><button class="btn small">Wire</button></div></div>`)}</div></section>
  <section data-layout="list" class="col"><h3 class="display-s">List</h3>
    ${['ex-range → ex-debounce', 'ex-debounce → ex-log', 'ex-input → ex-map'].map((n, i) => html`<div class="list-row"><span class="pill" style="color:${tv(`s${i + 1}` as NanoToken)}"></span>
      <span class="mono">${n}</span><span style="flex:1"></span><span class="badge good">live</span><button class="icon-btn" aria-label="Disconnect">✕</button></div>`)}</section>
  <section data-layout="form" class="col"><h3 class="display-s">Form</h3><div class="card col" style="max-width:420px">
    <label class="field">Name<input class="input" placeholder="my-component"></label><label class="field">System<select><option>host</option><option>lab</option></select></label>
    <div class="row"><button class="btn primary">Create</button><button class="btn">Cancel</button></div></div></section>
  <section data-layout="dashboard" class="col"><h3 class="display-s">Dashboard row</h3><div class="grid-auto">
    ${stat('Events in', '1,284', '+12%', true)}${stat('Batches out', '96', '+4%', true)}${stat('Refusals', '3', '+2', false)}
    <div class="card col"><span class="kicker">per minute</span>${bars()}</div></div></section>
  <section data-layout="table" class="col"><h3 class="display-s">Table</h3>${table()}</section>
</div>`;

/** Real components: the worked example (made by the host), attached by name. */
export const live = () => html`<div class="sample grid-auto">
  <div class="card col"><span class="kicker">ex-range</span><c-range name="ex-range"></c-range></div>
  <div class="card col"><span class="kicker">ex-input</span><c-input name="ex-input"></c-input></div>
  <div class="card col"><span class="kicker">ex-map</span><c-map name="ex-map"></c-map></div>
  <div class="card col" style="grid-column:1 / -1; height:260px"><span class="kicker">ex-debounce</span><c-debounce name="ex-debounce"></c-debounce></div>
  <div class="card col" style="grid-column:1 / -1"><span class="kicker">ex-log</span><c-log name="ex-log"></c-log></div>
</div>`;
