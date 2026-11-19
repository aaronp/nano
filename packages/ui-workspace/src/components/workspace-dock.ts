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
 * template / setTemplate(id): the panels in a fixed layout (dock/template-view.ts), or back in the kept dock ('dock').
 * arrangement(): the layout to save, golden-layout's config plus `template` when one shows.
 * Clicking into a panel focuses it (golden-layout marks its header lm_focused); a change of focused panel fires a
 * bubbling, composed `dock:focus` DOM event {system, instance, widget}, or null when the focused panel shows no
 * instance or nothing is focused (empty space clicked, the panel closed, the page changed: `route:changed` on the bus).
 * Light DOM, because golden-layout positions its drag proxy in document.body.
 *
 * On nano-core 0.4: `host` is the page's Host. A `pod` panel (addWidget('pod', name), as a click in the explorer
 * does) shows that pod's view (dock/panels.ts); <nano-explorer> and <nano-wiring> in a panel get the host's app.
 */
import { GoldenLayout, LayoutConfig, type Stack, type ComponentItem, type ResolvedLayoutConfig } from 'golden-layout/dist/esm/index.js';   // its ES build (src/dock/golden-layout.d.ts)
import type { Host } from '../host.ts';
import { ensureStyles, HEADER_H } from '../dock/dock-css.ts';
import { initial, readPalette, split, type Def } from '../dock/palette.ts';
import { mountPanel, panelOf, shows } from '../dock/panels.ts';
import { readSaved, writeSaved } from '../dock/saved.ts';
import { dragSource } from '../dock/sources.ts';
import { renderTemplate } from '../dock/template-view.ts';
import { requestBus, type Bus } from '../lib/bus.ts';
import { PALETTE_ID, windowStyle, type WindowStyle, panelIds } from '../lib/dock-layout.ts';
import { TEMPLATES, enabledFor, panelsInOrder, swap, templateState, type PanelState, type TemplateId, type TemplateState } from '../lib/layout-templates.ts';

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
  /** The template shown instead of golden-layout (which is then empty), and what removes it. */
  private tpl: { state: TemplateState; dispose(): void } | null = null;

  connectedCallback() {
    if (this.layout) return; /* already built (re-insertion) */
    ensureStyles(this.ownerDocument);
    if (!this.bus) {
      this.bus = requestBus(this);
      /* a page change clears focus: coming back, clicking the same panel reports it again */
      this.bus.subscribe('route:changed', () => { this.layout?.clearComponentFocus(); this.reportFocus(); });
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
    layout.registerComponentFactoryFunction('widget', (container, state) => mountPanel(container, state, this.mounting));
    layout.on('stateChanged', () => this.layout && this.send('dock:layout', { panels: this.openIds().length }));
    layout.on('focus', () => this.reportFocus());
    /* switching panels blurs the old one first: wait for the new focus, so only the change is sent */
    layout.on('blur', () => queueMicrotask(() => this.reportFocus()));
    /* empty space (not a panel, its tabs or a splitter being dragged) clears the focus */
    area.addEventListener('pointerdown', (e) => { if (!(e.target as Element).closest('.dock-panel, .lm_header, .lm_splitter')) layout.clearComponentFocus(); });
    this.layout = layout;
    for (const el of this.ownerDocument.querySelectorAll<HTMLElement>(`[data-dock-add="${CSS.escape(this.id)}"]`)) this.addSource(el, layout);
    const saved = this.readSaved();
    this.load(saved ?? initial(this, this.defs));
    if (saved) this.say('Opened your saved layout.');
    const t = templateState(localStorage, this.storageKey).get(); if (t?.order.every((s) => this.defs.has(s.widget))) this.show(t);
  }

  disconnectedCallback() {
    /* golden-layout keeps document-level listeners; tear down only when really removed */
    queueMicrotask(() => {
      if (this.isConnected) return;
      this.tpl?.dispose(); this.tpl = null;
      this.layout?.destroy();
      this.layout = null;
    });
  }

  /** Open a palette widget as a new panel; with `name`, its element shows that existing instance. It splits the focused
   * panel (else the largest): beside it as a new column when that panel is wider than tall, else below it as a new row.
   * In a template, a panel already showing `name` is focused; else the dock comes back and the panel is added there. */
  addWidget(id: string, name?: string) {
    const def = this.defs.get(id);
    if (!def) throw new Error(`<workspace-dock> has no palette widget "${id}"`);
    const at = this.tpl?.state.order.findIndex((s) => name && s.name === name) ?? -1;
    if (at >= 0) return this.querySelector<HTMLElement>(`.dock-template .tpl-pos[data-area="${TEMPLATES.find((x) => x.id === this.template)!.areas[at]}"] .dock-panel`)?.focus();
    this.setTemplate('dock');
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
  setWindowStyle(s: WindowStyle) { windowStyle(localStorage, this.storageKey).set(s); this.setAttribute('chrome', s); }

  /** Fires `dock:save-as` with this layout, for the page to save it as a workspace of its own. */
  saveAs() { this.dispatchEvent(new CustomEvent('dock:save-as', { bubbles: true, composed: true, detail: { layout: this.kept, system: this.system } })); }

  /** The template shown, or 'dock' for golden-layout. */
  get template(): TemplateId { return this.tpl?.state.template ?? 'dock'; }
  /** Shows the panels in template `id`, or back in the kept dock; false (and why, as dock:status) when it does not fit
   * the panel count or an implementation's pod is still being made. */
  setTemplate(id: TemplateId): boolean {
    if (id === 'dock') { if (this.tpl) this.load(LayoutConfig.fromResolved(this.kept)); return true; }
    const order = this.tpl?.state.order ?? panelsInOrder(this.kept.root), t = TEMPLATES.find((x) => x.id === id)!;
    const why = !enabledFor(order.length).has(id) ? `${t.title} needs ${t.positions} panels; this page has ${order.length}.`
      : order.some((s) => this.defs.get(s.widget)?.template.dataset['implementation'] && !s.name) ? 'Wait until every new pod is made.' : undefined;
    if (why) { this.say(why); return false; }
    this.show({ template: id, order, dock: this.kept });
    return true;
  }

  /** The layout to save: golden-layout's config (the kept one while a template shows), with `template` when one does. */
  arrangement(): { root?: unknown; template?: TemplateState } & Record<string, unknown> {
    return this.tpl ? { ...this.kept, template: this.tpl.state } : { ...this.kept };
  }

  /** Fires `dock:connections`, for whatever wraps the dock (the wiring view). */
  connections() { this.dispatchEvent(new CustomEvent('dock:connections', { bubbles: true, composed: true })); }

  /** Ids of the panels currently open, in layout order. */
  openIds(): readonly string[] { return panelIds(this.kept.root as never); }

  private get storageKey(): string {
    const k = this.getAttribute('storage-key');
    if (!k) throw new Error('<workspace-dock> needs a storage-key attribute to save layouts');
    return k;
  }

  private get system(): string { return this.getAttribute('system') ?? 'host'; }
  private send(topic: string, payload: unknown) { this.requireBus().publish(topic, payload, 'workspace-dock'); }
  private say(message: string) { this.send('dock:status', { message }); }

  /** Sends `dock:focus` when the focused panel has changed: its instance, or null if it shows none or none is focused. */
  private reportFocus(item = this.layout?.focusedComponentItem) {
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

  /** Makes an element (its data-widget names a palette widget) a drag source for this dock, and click-to-add. */
  addSource(el: HTMLElement, layout = this.requireLayout()) { dragSource(el, layout, this.defs, (id) => this.addWidget(id)); }

  /** What mountPanel needs from the dock. */
  private get mounting() { return { doc: this.ownerDocument, defs: this.defs, bus: this.requireBus(), host: this.host, registry: this.registry, send: (t: string, p: unknown) => this.send(t, p) }; }

  /** golden-layout's config: the kept one while a template shows. */
  private get kept(): ResolvedLayoutConfig { return (this.tpl?.state.dock as ResolvedLayoutConfig | undefined) ?? this.requireLayout().saveLayout(); }

  /** Shows template state `s` in place of golden-layout (cleared), and remembers it (a swap too). */
  private show(s: TemplateState) {
    if (this.tpl) this.tpl.dispose(); else { this.requireLayout().clearComponentFocus(); this.requireLayout().clear(); }
    const mount = (el: HTMLElement, st: PanelState, item: ComponentItem) => { mountPanel(item.container, st, this.mounting); for (const type of ['pointerdown', 'focusin']) el.addEventListener(type, () => this.reportFocus(item)); };
    const remember = () => templateState(localStorage, this.storageKey).set(s);
    this.tpl = { state: s, dispose: renderTemplate(this.querySelector<HTMLElement>(':scope > .dock-area')!, s.template, s.order, mount, (i, j) => { s.order = swap(s.order, i, j); remember(); }) };
    remember();
  }

  private requireLayout(): GoldenLayout { if (!this.layout) throw new Error('bug: workspace used before it was connected'); return this.layout; }
  private requireBus(): Bus { if (!this.bus) throw new Error('bug: workspace used before it was connected'); return this.bus; }

  /** Loads `config`, sized for the dock's tab bar. */
  private load(config: LayoutConfig) {
    if (this.tpl) { this.tpl.dispose(); this.tpl = null; templateState(localStorage, this.storageKey).set(null); this.reportFocus(); }
    this.requireLayout().clearComponentFocus();   // the focused panel is about to go: dock:focus null, not a stale panel
    this.requireLayout().loadLayout({ ...config, dimensions: { ...config.dimensions, headerHeight: HEADER_H } });
  }

  /** A remembered layout, if storage works and it only names widgets this palette still has. */
  private readSaved() { return readSaved(localStorage, this.storageKey, (id) => this.defs.has(id), (m) => this.say(m)); }

  save() {
    const message = writeSaved(localStorage, this.storageKey, this.kept);
    if (message) { this.say(message); return this.send('dock:error', { message }); }
    this.say('Layout saved.');
    // BACKLOG(3): its route's screen got the layout too (setLayout on the Application's screens); 0.4 has no screens.
    this.ownerDocument.dispatchEvent(new CustomEvent('nano:changed'));   // the working copy follows
    this.send('dock:saved', { panels: this.openIds().length });
  }

  restore() {
    const saved = this.readSaved();
    if (!saved) return this.say('No saved layout yet.');
    const t = templateState(localStorage, this.storageKey).get();   // load() clears it: an imported template re-enters after
    this.load(saved); this.say('Layout restored.');
    if (t?.order.every((s) => this.defs.has(s.widget))) this.show(t);
  }

  reset() { this.load(initial(this, this.defs)); this.say('Back to the starting layout.'); }
}

customElements.define('workspace-dock', WorkspaceDock);
