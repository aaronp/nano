/**
 * <workspace-dock>: a golden-layout workspace. Panels can be dragged by their tabs, docked, stacked as tabs,
 * resized, maximised and closed. The arrangement can be saved, restored and reset.
 *
 *   <workspace-dock id="workspace" storage-key="my-app.workspace" open="notes,chart" arrangement="grid">
 *     <template data-widget="notes" data-title="Notes"> …any markup or widget… </template>   (one per palette entry)
 *   </workspace-dock>
 *
 * Adding panels: any element in the page with data-dock-add="<this id>" data-widget="<palette id>" (the drawer
 * sub-items in index.html) can be clicked to add that widget, or dragged into the layout to place it.
 * A saved layout opens automatically next time. Panels refer to widgets by id, so saved layouts hold no markup.
 *
 * Bus topics (the app bus): dock:opened {widget} · dock:layout {panels} · dock:saved · dock:error {message}.
 * The toolbar's window style select switches between tabs and distraction free (remembered per dock).
 * The toolbar's Save workspace… button fires a bubbling `dock:save-as` {layout} event, for the page to save it as a
 * workspace of its own (saved-workspaces.ts).
 * The toolbar's Connections button fires a bubbling `dock:connections` DOM event; whatever wraps the dock (the
 * wiring view) decides what it means.
 * Light DOM, because golden-layout positions its drag proxy in document.body.
 */
import { GoldenLayout, LayoutConfig, type ComponentContainer, type JsonValue, type ResolvedLayoutConfig } from 'golden-layout';
import baseCss from 'golden-layout/dist/css/goldenlayout-base.css';
import { provideBus, requestBus, type Bus } from '../lib/bus.ts';
import { panelContent } from '../lib/panel-content.ts';
import { ARRANGEMENTS, PALETTE_ID, WINDOW_STYLES, windowStyle, type WindowStyle, initialLayout, panelIds, readWidgetId, readWidgetName, panelState, type Arrangement, type PaletteEntry } from '../lib/dock-layout.ts';

const STYLE_ID = 'workspace-dock-styles';
/** The tab bar's height: the CSS draws it, and golden-layout must size panels for it too (saved layouts included). */
const HEADER_H = 30;
const DOCK_CSS = `
workspace-dock { display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100%; background: var(--bg); color: var(--fg); font: 14px var(--font); }
workspace-dock .dock-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid var(--line); background: var(--surface); }
workspace-dock .dock-bar h2 { margin: 0 8px 0 0; font: 600 15px var(--display); }
workspace-dock .dock-bar .hint, workspace-dock .dock-bar .status { color: var(--muted); font-size: 12px; }
workspace-dock .dock-bar .grow { flex: 1; }
workspace-dock .dock-bar button { font: inherit; font-size: 13px; padding: 5px 10px; border: var(--card-border); border-radius: var(--radius); background: var(--surface-2); color: var(--fg); cursor: pointer; }
workspace-dock .dock-bar button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
workspace-dock .dock-area { position: relative; min-height: 0; overflow: hidden; }
.dock-panel { box-sizing: border-box; height: 100%; overflow: auto; padding: 14px; background: var(--surface); color: var(--fg); font-family: var(--font); }
.dock-panel.flush { padding: 0; }
.lm_goldenlayout { background: var(--bg); }
.lm_content { background: var(--surface); border: 1px solid var(--line); box-sizing: border-box; }
.lm_splitter { background: var(--line); opacity: .6; transition: opacity .15s; }
.lm_splitter:hover, .lm_splitter.lm_dragging { background: var(--accent); opacity: 1; }
.lm_header { height: ${HEADER_H}px; }
/* plain text tabs: the active one is underlined; a tab's close shows on hover */
.lm_header .lm_tabs { gap: 4px; padding-left: 4px; }
.lm_header .lm_tab { height: 28px; line-height: 28px; padding: 0 22px 0 8px; font: 12px var(--font); color: var(--muted); background: none; border: 0; border-radius: 0; box-shadow: none; }
.lm_header .lm_tab:hover { color: var(--fg); }
.lm_header .lm_tab.lm_active { color: var(--fg); background: none; font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
.lm_header .lm_tab .lm_close_tab, .lm_controls > li { width: 11px; height: 11px; opacity: .55; background-repeat: no-repeat; background-position: center; background-size: 11px; cursor: pointer; }
.lm_header .lm_tab .lm_close_tab { position: absolute; top: 9px; right: 6px; opacity: 0; }
.lm_header .lm_tab:hover .lm_close_tab { opacity: .55; }
.lm_controls { display: flex; gap: 8px; top: 9px; right: 8px; }
.lm_controls > li:hover, .lm_header .lm_tab .lm_close_tab:hover { opacity: 1; }
.lm_maximise { background-image: var(--icon-max); }
.lm_maximised .lm_maximise { background-image: var(--icon-min); }
.lm_close, .lm_close_tab { background-image: var(--icon-close); }
.lm_dragProxy .lm_content { box-shadow: 0 10px 30px rgb(0 0 0 / .25); }
.lm_dropTargetIndicator { outline: 2px dashed var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); transition: all .1s; }
.lm_dropTargetIndicator .lm_inner { background: transparent; }
.lm_maximised { z-index: 40; }
.lm_dragging, .lm_dragging * { cursor: grabbing !important; user-select: none; }
[data-dock-add] { cursor: grab; }
workspace-dock .dock-bar select { font: inherit; font-size: 13px; padding: 4px 6px; border: var(--card-border); border-radius: var(--radius); background: var(--surface-2); color: var(--fg); }
/* Distraction free: a stack with one panel has no tab bar; its maximise and close float over it on hover.
   Stacked panels keep their tabs. The panel takes the header's room (golden-layout sizes it inline). */
workspace-dock[chrome="focus"] .lm_stack:not(:has(.lm_tab + .lm_tab)) > .lm_header { position: absolute; top: 0; right: 0; left: auto; width: 0 !important; z-index: 5; opacity: 0; transition: opacity .15s; }
workspace-dock[chrome="focus"] .lm_stack:not(:has(.lm_tab + .lm_tab)) > .lm_header .lm_tabs { display: none; }
workspace-dock[chrome="focus"] .lm_stack:not(:has(.lm_tab + .lm_tab)):hover > .lm_header,
workspace-dock[chrome="focus"] .lm_stack:not(:has(.lm_tab + .lm_tab)) > .lm_header:focus-within { opacity: 1; }
workspace-dock[chrome="focus"] .lm_stack:not(:has(.lm_tab + .lm_tab)) > .lm_header .lm_controls { top: 6px; right: 6px; padding: 5px 7px; border-radius: 6px; background: var(--surface-2); border: 1px solid var(--line); }
workspace-dock[chrome="focus"] .lm_stack:not(:has(.lm_tab + .lm_tab)) > .lm_items,
workspace-dock[chrome="focus"] .lm_stack:not(:has(.lm_tab + .lm_tab)) > .lm_items > .lm_item { height: 100% !important; }
`;

const icon = (path: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="none" stroke="#7a808c" stroke-width="1.6">${path}</svg>`)}")`;

const ensureStyles = (doc: Document) => {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `:root { --icon-close: ${icon('<path d="M2 2l8 8M10 2l-8 8"/>')}; --icon-max: ${icon('<rect x="1.5" y="1.5" width="9" height="9"/>')}; --icon-min: ${icon('<path d="M2 9.5h8"/>')}; }\n${baseCss}\n${DOCK_CSS}`;
  doc.head.append(style);
};

interface Def extends PaletteEntry { readonly template: HTMLTemplateElement }

export class WorkspaceDock extends HTMLElement {
  /** The system (registry) the panels' components live in; unset, they use the page's provided registry. Declared,
   * not a class field: a field would wipe a value set before the element upgrades (saved workspaces set it at start). */
  declare registry?: unknown;
  private bus: Bus | null = null;
  private layout: GoldenLayout | null = null;
  private defs = new Map<string, Def>();
  private status: HTMLElement | null = null;

  connectedCallback() {
    if (this.layout) return; /* already built (re-insertion) */
    ensureStyles(this.ownerDocument);
    this.bus ??= requestBus(this);
    if (!this.id) throw new Error('<workspace-dock> needs an id so drawer items can target it');
    this.defs = this.readPalette();

    const bar = this.el('div', 'dock-bar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Workspace');
    const title = this.el('h2', undefined, this.getAttribute('label') ?? 'Workspace');
    const hint = this.el('span', 'hint', 'Add widgets from the menu: click to add, or drag into place.');
    this.status = this.el('span', 'status');
    this.status.setAttribute('role', 'status');
    const connections = this.button('⇄ Connections', () => this.dispatchEvent(new CustomEvent('dock:connections', { bubbles: true, composed: true })));
    connections.title = 'Show the connections behind the workspace';
    const style = windowStyle(localStorage, this.storageKey);
    const pick = this.el('select');
    pick.setAttribute('aria-label', 'Window style');
    for (const s of WINDOW_STYLES) pick.append(new Option(s.title, s.id));
    pick.value = style.get();
    this.setAttribute('chrome', pick.value);
    pick.addEventListener('change', () => { style.set(pick.value as WindowStyle); this.setAttribute('chrome', pick.value); });
    bar.append(title, hint, this.el('span', 'grow'), this.status, pick, connections,
      this.button('Save workspace…', () => this.dispatchEvent(new CustomEvent('dock:save-as', { bubbles: true, composed: true, detail: { layout: this.requireLayout().saveLayout(), system: this.getAttribute('system') ?? 'host' } }))),
      this.button('Save layout', () => this.save()), this.button('Restore', () => this.restore()), this.button('Reset', () => this.reset()));
    const area = this.el('div', 'dock-area');
    this.append(bar, area);

    const layout = new GoldenLayout(area);
    layout.resizeWithContainerAutomatically = true;
    layout.registerComponentFactoryFunction('widget', (container, state) => this.mount(container, state));
    layout.on('stateChanged', () => this.send('dock:layout', { panels: this.openIds().length }));
    this.layout = layout;
    this.connectSources(layout);
    const saved = this.readSaved();
    this.load(saved ?? this.initial());
    if (saved) this.say('Opened your saved layout.');
  }

  disconnectedCallback() {
    /* golden-layout keeps document-level listeners; tear down only when really removed */
    queueMicrotask(() => {
      if (this.isConnected) return;
      this.layout?.destroy();
      this.layout = null;
    });
  }

  /** Open a palette widget as a new panel; with `name`, its element shows that existing instance. */
  addWidget(id: string, name?: string) {
    const def = this.defs.get(id);
    if (!def) throw new Error(`<workspace-dock> has no palette widget "${id}"`);
    this.requireLayout().addComponent('widget', name ? { widget: def.id, name } : { widget: def.id }, name ?? def.title);
  }

  /** Ids of the panels currently open, in layout order. */
  openIds(): readonly string[] {
    const root = this.requireLayout().saveLayout().root;
    return panelIds(root as never);
  }

  private get storageKey(): string {
    const k = this.getAttribute('storage-key');
    if (!k) throw new Error('<workspace-dock> needs a storage-key attribute to save layouts');
    return k;
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = this.el('button', undefined, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  private send(topic: string, payload: unknown) {
    if (!this.bus) throw new Error('bug: workspace used before it was connected');
    this.bus.publish(topic, payload, 'workspace-dock');
  }

  private say(message: string) { if (this.status) this.status.textContent = message; }

  private readPalette(): Map<string, Def> {
    const defs = new Map<string, Def>();
    for (const t of this.querySelectorAll<HTMLTemplateElement>(':scope > template[data-widget]')) {
      const id = t.dataset['widget'] ?? '';
      if (!PALETTE_ID.test(id)) throw new Error(`<template data-widget="${id}"> needs a kebab-case id`);
      if (defs.has(id)) throw new Error(`duplicate workspace widget id ${id}`);
      defs.set(id, { id, title: t.dataset['title'] ?? id, template: t });
    }
    if (defs.size === 0) throw new Error('<workspace-dock> needs at least one <template data-widget="…">');
    return defs;
  }

  private initial(): LayoutConfig {
    const open = (this.getAttribute('open') ?? [...this.defs.keys()].slice(0, 1).join(',')).split(',').map((x) => x.trim()).filter(Boolean);
    const entries = open.map((id) => {
      const d = this.defs.get(id);
      if (!d) throw new Error(`<workspace-dock open="…"> names unknown widget "${id}"`);
      return d;
    });
    const arrangement = (this.getAttribute('arrangement') ?? 'row') as Arrangement;
    if (!ARRANGEMENTS.includes(arrangement)) throw new Error(`<workspace-dock arrangement> must be one of ${ARRANGEMENTS.join(', ')}`);
    const { root } = initialLayout(entries, arrangement);
    return { root: root as never, header: { popout: false } };
  }

  /** Any data-dock-add element targeting this dock becomes a drag source and a click-to-add button. */
  private connectSources(layout: GoldenLayout) {
    for (const el of this.ownerDocument.querySelectorAll<HTMLElement>(`[data-dock-add="${CSS.escape(this.id)}"]`)) this.addSource(el, layout);
  }

  /** Makes an element (its data-widget names a palette widget) a drag source for this dock, and click-to-add. */
  addSource(el: HTMLElement, layout = this.requireLayout()) {
    const id = el.dataset['widget'] ?? '';
    const def = this.defs.get(id);
    if (!def) throw new Error(`menu item targets unknown workspace widget "${id}"`);
    el.setAttribute('draggable', 'false');
    layout.newDragSource(el, () => ({ type: 'component', componentType: 'widget', componentState: { widget: def.id }, title: def.title }));
    /* a link's own navigation (to the workspace page) happens first; add once the page is shown */
    el.addEventListener('click', (e) => { e.preventDefault(); requestAnimationFrame(() => this.addWidget(def.id)); });
  }

  private mount(container: ComponentContainer, state: JsonValue | undefined) {
    const id = readWidgetId(state);
    const def = this.defs.get(id);
    if (!def) throw new Error(`layout refers to unknown workspace widget "${id}"`);
    container.element.classList.add('dock-panel');
    if (def.template.hasAttribute('data-flush')) container.element.classList.add('flush');
    /* golden-layout may build a panel inside its drag proxy (in document.body), so each panel provides the bus itself */
    if (!this.bus) throw new Error('bug: panel mounted before the workspace was connected');
    provideBus(container.element, this.bus);
    // upgraded at once, with placed elements in the dock's system (if it has one)
    const content = panelContent(this.ownerDocument, def.template, this.registry);
    const name = readWidgetName(state);
    const shown = content.firstElementChild as (Element & { model?: unknown }) | null;
    if (name) shown?.setAttribute('name', name);   // before it connects, so it attaches to that instance
    container.element.append(content);
    // saved layouts name the instance each panel shows, so Reset and Restore reattach instead of making new ones
    container.stateRequestEvent = () => panelState(id, shown);
    this.send('dock:opened', { widget: id });
    return undefined;
  }

  private requireLayout(): GoldenLayout {
    if (!this.layout) throw new Error('bug: workspace used before it was connected');
    return this.layout;
  }

  /** A remembered layout, if storage works and it only names widgets this palette still has. */
  private load(config: LayoutConfig) {
    this.requireLayout().loadLayout({ ...config, dimensions: { ...config.dimensions, headerHeight: HEADER_H } });
  }

  private readSaved(): LayoutConfig | null {
    let raw: string | null;
    try { raw = localStorage.getItem(this.storageKey); } catch { return null; }
    if (raw === null) return null;
    const resolved = JSON.parse(raw) as ResolvedLayoutConfig;
    const unknown = panelIds(resolved.root as never).filter((id) => !this.defs.has(id));
    if (unknown.length) { this.say(`Saved layout ignored: it uses widgets that no longer exist (${unknown.join(', ')}).`); return null; }
    return LayoutConfig.fromResolved(resolved);
  }

  private save() {
    const resolved = this.requireLayout().saveLayout();
    try { localStorage.setItem(this.storageKey, JSON.stringify(resolved)); } catch (err) {
      const message = `Could not save the layout: ${(err as Error).message}`;
      this.say(message);
      this.send('dock:error', { message });
      return;
    }
    this.say('Layout saved.');
    this.send('dock:saved', { panels: this.openIds().length });
  }

  private restore() {
    const saved = this.readSaved();
    if (!saved) { this.say('No saved layout yet.'); return; }
    this.load(saved);
    this.say('Layout restored.');
  }

  private reset() {
    this.load(this.initial());
    this.say('Back to the starting layout.');
  }
}

customElements.define('workspace-dock', WorkspaceDock);
