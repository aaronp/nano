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
 * Bus topics (the app bus): dock:opened {widget} · dock:layout {panels} · dock:saved · dock:error {message} ·
 * dock:status {message} (what the last command did, for a status line).
 * The dock has no toolbar: its commands are public, for controls elsewhere (the app bar) to call.
 *   windowStyle / setWindowStyle(s): tabs or clear (remembered per dock).
 *   save() / restore() / reset(): the layout. saveAs() fires a bubbling `dock:save-as` {layout, system} event, for the
 *   page to save it as a workspace of its own (saved-workspaces.ts). connections() fires a bubbling
 *   `dock:connections` DOM event; whatever wraps the dock (the wiring view) decides what it means.
 * Clicking into a panel focuses it (golden-layout marks its header lm_focused); a change of focused panel fires a
 * bubbling, composed `dock:focus` DOM event {system, instance, widget}, or null when the focused panel shows no
 * instance or nothing is focused (empty space clicked, the panel closed, the page changed: `route:changed` on the bus).
 * Light DOM, because golden-layout positions its drag proxy in document.body.
 *
 * On nano-core 0.4: `host` is the page's Host. A `pod` panel (addWidget('pod', name), as a click in the explorer
 * does) shows that pod's view (dock/panels.ts); <nano-explorer> and <nano-wiring> in a panel get the host's app.
 */
import { GoldenLayout, type LayoutConfig, type Stack, type ComponentItem } from 'golden-layout/dist/esm/index.js';   // its ES build (src/dock/golden-layout.d.ts)
import type { Host } from '../host.ts';
import { ensureStyles, HEADER_H } from '../dock/dock-css.ts';
import { initial, readPalette, split, type Def } from '../dock/palette.ts';
import { mountPanel, panelOf, shows } from '../dock/panels.ts';
import { readSaved } from '../dock/saved.ts';
import { requestBus, type Bus } from '../lib/bus.ts';
import { PALETTE_ID, windowStyle, type WindowStyle, panelIds } from '../lib/dock-layout.ts';

export class WorkspaceDock extends HTMLElement {
  /** The system (registry) the panels' components live in; unset, they use the page's provided registry. Declared,
   * not a class field: a field would wipe a value set before the element upgrades (saved workspaces set it at start). */
  declare registry?: unknown;
  /** The page's host (main.ts sets it): pod panels and the nano-ui elements in panels show its app. */
  declare host?: Host;
  private bus: Bus | null = null;
  private layout: GoldenLayout | null = null;
  private defs = new Map<string, Def>();
  /** The focused item last reported in dock:focus, so only changes are sent. */
  private focused: ComponentItem | undefined;

  connectedCallback() {
    if (this.layout) return; /* already built (re-insertion) */
    ensureStyles(this.ownerDocument);
    if (!this.bus) {
      this.bus = requestBus(this);
      /* a page change clears focus: coming back, clicking the same panel reports it again */
      this.bus.subscribe('route:changed', () => this.layout?.clearComponentFocus());
    }
    if (!this.id) throw new Error('<workspace-dock> needs an id so drawer items can target it');
    this.defs = readPalette(this);
    this.defs.set('pod', { id: 'pod', title: 'Pod', template: this.ownerDocument.createElement('template') });   // not in the drawer: the explorer opens it
    this.addEventListener('nano-open', (e) => this.openPod((e as CustomEvent<{ pod: string }>).detail.pod));

    this.setAttribute('chrome', this.windowStyle);
    const area = Object.assign(document.createElement('div'), { className: 'dock-area' });
    this.append(area);

    const layout = new GoldenLayout(area);
    layout.resizeWithContainerAutomatically = true;
    layout.registerComponentFactoryFunction('widget', (container, state) => {
      if (!this.bus) throw new Error('bug: panel mounted before the workspace was connected');
      mountPanel(container, state, { doc: this.ownerDocument, defs: this.defs, bus: this.bus, host: this.host, registry: this.registry, send: (t, p) => this.send(t, p) });
    });
    layout.on('stateChanged', () => this.send('dock:layout', { panels: this.openIds().length }));
    layout.on('focus', () => this.reportFocus());
    /* switching panels blurs the old one first: wait for the new focus, so only the change is sent */
    layout.on('blur', () => queueMicrotask(() => this.reportFocus()));
    /* empty space (not a panel, its tabs or a splitter being dragged) clears the focus */
    area.addEventListener('pointerdown', (e) => { if (!(e.target as Element).closest('.dock-panel, .lm_header, .lm_splitter')) layout.clearComponentFocus(); });
    this.layout = layout;
    this.connectSources(layout);
    const saved = this.readSaved();
    this.load(saved ?? initial(this, this.defs));
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

  /** Open a palette widget as a new panel; with `name`, its element shows that existing instance. It splits the focused
   * panel (else the largest): beside it as a new column when that panel is wider than tall, else below it as a new row. */
  addWidget(id: string, name?: string) {
    const def = this.defs.get(id);
    if (!def) throw new Error(`<workspace-dock> has no palette widget "${id}"`);
    split(this.requireLayout(), name ? { widget: def.id, name } : { widget: def.id }, name ?? def.title);
  }

  /** Adds a palette widget while running (an imported package's kind): its template, now addable. */
  addTemplate(t: HTMLTemplateElement) {
    const id = t.dataset['widget'] ?? '';
    if (!PALETTE_ID.test(id) || this.defs.has(id)) return;
    this.append(t);
    this.defs.set(id, { id, title: t.dataset['title'] ?? id, template: t });
  }

  /** How panels are framed (remembered per dock). */
  get windowStyle(): WindowStyle { return windowStyle(localStorage, this.storageKey).get(); }

  setWindowStyle(s: WindowStyle) {
    windowStyle(localStorage, this.storageKey).set(s);
    this.setAttribute('chrome', s);
  }

  /** Fires `dock:save-as` with this layout, for the page to save it as a workspace of its own. */
  saveAs() {
    this.dispatchEvent(new CustomEvent('dock:save-as', { bubbles: true, composed: true, detail: { layout: this.requireLayout().saveLayout(), system: this.system } }));
  }

  /** Fires `dock:connections`, for whatever wraps the dock (the wiring view). */
  connections() {
    this.dispatchEvent(new CustomEvent('dock:connections', { bubbles: true, composed: true }));
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

  private get system(): string { return this.getAttribute('system') ?? 'host'; }

  private send(topic: string, payload: unknown) {
    if (!this.bus) throw new Error('bug: workspace used before it was connected');
    this.bus.publish(topic, payload, 'workspace-dock');
  }

  private say(message: string) { this.send('dock:status', { message }); }

  /** Sends `dock:focus` when the focused panel has changed: its instance, or null if it shows none or none is focused. */
  private reportFocus() {
    const item = this.layout?.focusedComponentItem;
    if (item === this.focused) return;
    this.focused = item;
    const instance = item && shows(item, this.defs);
    this.dispatchEvent(new CustomEvent('dock:focus', { bubbles: true, composed: true, detail: instance ? { system: this.system, instance, widget: this.id } : null }));
  }

  /** Shows a pod: the panel already showing it, made active and focused; else a new `pod` panel. */
  openPod(pod: string) {
    const found = panelOf(this.layout?.rootItem, pod, this.defs);
    if (!found) return this.addWidget('pod', pod);
    (found.parentItem as Stack).setActiveComponentItem(found, true);
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

  private requireLayout(): GoldenLayout {
    if (!this.layout) throw new Error('bug: workspace used before it was connected');
    return this.layout;
  }

  /** Loads `config`, sized for the dock's tab bar. */
  private load(config: LayoutConfig) {
    this.requireLayout().clearComponentFocus();   // the focused panel is about to go: dock:focus null, not a stale panel
    this.requireLayout().loadLayout({ ...config, dimensions: { ...config.dimensions, headerHeight: HEADER_H } });
  }

  /** A remembered layout, if storage works and it only names widgets this palette still has. */
  private readSaved(): LayoutConfig | null {
    const saved = readSaved(localStorage, this.storageKey, (id) => this.defs.has(id));
    if (saved && 'ignored' in saved) { this.say(`Saved layout ignored: it uses widgets that no longer exist (${saved.ignored.join(', ')}).`); return null; }
    return saved;
  }

  save() {
    const resolved = this.requireLayout().saveLayout();
    try { localStorage.setItem(this.storageKey, JSON.stringify(resolved)); } catch (err) {
      const message = `Could not save the layout: ${(err as Error).message}`;
      this.say(message);
      this.send('dock:error', { message });
      return;
    }
    this.say('Layout saved.');
    // BACKLOG(3): its route's screen got the layout too (setLayout on the Application's screens); 0.4 has no screens.
    this.ownerDocument.dispatchEvent(new CustomEvent('nano:changed'));   // the working copy follows
    this.send('dock:saved', { panels: this.openIds().length });
  }

  restore() {
    const saved = this.readSaved();
    if (!saved) { this.say('No saved layout yet.'); return; }
    this.load(saved);
    this.say('Layout restored.');
  }

  reset() {
    this.load(initial(this, this.defs));
    this.say('Back to the starting layout.');
  }
}

customElements.define('workspace-dock', WorkspaceDock);
