/**
 * <workspace-dock>: a golden-layout workspace. Panels can be dragged by their tabs, docked, stacked as tabs,
 * resized, maximised and closed. The arrangement can be saved, restored and reset.
 *
 *   <workspace-dock id="workspace" storage-key="my-app.workspace" open="notes,chart" arrangement="grid">
 *     <template data-widget="notes" data-title="Notes"> …any markup or widget… </template>   (one per palette entry)
 *   </workspace-dock>
 * Adding panels: each panel header's `+` opens the picker (picker.ts) and splits that panel for the choice; an empty dock
 * shows one large `+`. A saved layout opens automatically next time. Panels refer to widgets by id, so saved layouts hold no markup.
 * Bus topics (the app bus): dock:opened {widget} · dock:layout {panels} · dock:saved · dock:error {message} ·
 * dock:status {message} (what the last command did, for a status line).
 * The dock has no toolbar: its commands are public, for controls elsewhere (the app bar) to call.
 *   windowStyle / setWindowStyle(s): tabs or clear (remembered per dock).
 *   save() / restore() / reset(): the layout. saveAs() fires a bubbling `dock:save-as` {layout, system} event, for the
 *   page to save it as a workspace of its own (workspace-pages.ts). connections() fires a bubbling
 *   `dock:connections` DOM event; whatever wraps the dock (the wiring view) decides what it means.
 * template / setTemplate(id): panels in a fixed layout (layout-templates.ts; dock/template-mode.ts), what does not fit
 * parked; 'dock' undoes it; false only while a new pod is being made.
 * arrangement(): the layout to save: golden-layout's config plus `template` (parked panels included) when one shows.
 * Clicking into a panel focuses it (golden-layout marks its header lm_focused); a change of focused panel fires a
 * bubbling, composed `dock:focus` DOM event {system, instance, widget}, or null when the focused panel shows no
 * instance or nothing is focused (empty space clicked, the panel closed, the page changed: `route:changed` on the bus).
 * Light DOM, because golden-layout positions its drag proxy in document.body.
 * On nano-core 0.4: `host` is the page's Host. A `pod` panel (addWidget('pod', name), as a click in the explorer
 * does) shows that pod's view (dock/panels.ts); <nano-explorer> and <nano-wiring> in a panel get the host's app.
 */
import { GoldenLayout, LayoutConfig, type Stack, type ComponentItem, type ContentItem, type ResolvedLayoutConfig } from 'golden-layout/dist/esm/index.js';   // its ES build (src/dock/golden-layout.d.ts)
import type { Host } from '../host.ts';
import { ensureStyles, HEADER_H } from '../dock/dock-css.ts';
import { initial, readPalette, split, type Def } from '../dock/palette.ts';
import { mountPanel, panelOf, shows } from '../dock/panels.ts';
import { readSaved, writeSaved } from '../dock/saved.ts';
import { showTemplate } from '../dock/template-mode.ts';
import { pick } from './picker.ts';
import { requestBus, type Bus } from '../lib/bus.ts';
import { PALETTE_ID, windowStyle, type WindowStyle, panelIds } from '../lib/dock-layout.ts';
import { TEMPLATES, panelsInOrder, place, relayout, templateState, type PanelState, type TemplateId, type TemplateState } from '../lib/layout-templates.ts';

export class WorkspaceDock extends HTMLElement {
  /** The system (registry) the panels' components live in; unset, they use the page's provided registry. Declared,
   * not a class field: a field would wipe a value set before the element upgrades (saved workspaces set it at start). */
  declare registry?: unknown;
  /** The page's host (main.ts sets it after the docks connect: panels already up are made again with it); pod panels show its app. */
  get host(): Host | undefined { return this.#host; }
  set host(h) { const late = !this.#host && h && this.layout; this.#host = h; if (late) { if (this.tpl) this.show(this.tpl.state); else this.load(LayoutConfig.fromResolved(this.kept)); } }
  #host?: Host;
  private bus: Bus | null = null;
  private layout: GoldenLayout | null = null;
  private defs = new Map<string, Def>();
  /** The focused item last reported in dock:focus, so only changes are sent. */
  private focused: ComponentItem | undefined;
  /** The template shown instead of golden-layout (which is then empty); the large `+` of an empty dock. */
  private tpl: ReturnType<typeof showTemplate> | null = null;
  private empty: HTMLElement | null = null;

  connectedCallback() {
    if (this.layout) return; /* already built (re-insertion) */
    if (Object.hasOwn(this, 'host')) { const h = this.host; delete (this as { host?: Host }).host; this.host = h; }   // set before the element upgraded
    ensureStyles(this.ownerDocument);
    if (!this.bus) {
      this.bus = requestBus(this);
      /* a page change clears focus: coming back, clicking the same panel reports it again */
      this.bus.subscribe('route:changed', () => { this.layout?.clearComponentFocus(); this.reportFocus(); });
    }
    if (!this.id) throw new Error('<workspace-dock> needs an id');
    this.defs = readPalette(this);
    this.defs.set('pod', { id: 'pod', title: 'Pod', template: this.ownerDocument.createElement('template') });   // not in the picker: the explorer opens it
    this.addEventListener('nano-open', (e) => this.openPod((e as CustomEvent<{ pod: string }>).detail.pod));
    this.setAttribute('chrome', this.windowStyle);
    const area = Object.assign(document.createElement('div'), { className: 'dock-area' });
    this.append(area);
    const layout = new GoldenLayout(area);
    layout.resizeWithContainerAutomatically = true;
    layout.registerComponentFactoryFunction('widget', (container, state) => mountPanel(container, state, this.mounting));
    layout.on('stateChanged', () => this.layout && this.changed());
    layout.on('itemCreated', (e) => { const s = e.target as ContentItem; if (s.isStack) this.plus((s as Stack).header.controlsContainerElement, 'dock-split', () => (s as Stack).getActiveComponentItem()); });
    layout.on('focus', () => this.reportFocus());
    /* switching panels blurs the old one first: wait for the new focus, so only the change is sent */
    layout.on('blur', () => queueMicrotask(() => this.reportFocus()));
    /* empty space (not a panel, its tabs or a splitter being dragged) clears the focus */
    area.addEventListener('pointerdown', (e) => { if (!(e.target as Element).closest('.dock-panel, .lm_header, .lm_splitter')) layout.clearComponentFocus(); });
    this.layout = layout;
    this.empty = this.plus(area, 'dock-empty');
    const saved = this.readSaved();
    this.load(saved ?? initial(this, this.defs));
    if (saved) this.say('Opened your saved layout.');
    const t = templateState(localStorage, this.storageKey).get(); if (t && this.known(t)) this.show(t);
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
   * panel (else the largest; palette.ts). In a template, a panel already showing `name` is focused, else the first empty
   * position filled; else the dock comes back and the panel is added there. */
  addWidget(id: string, name?: string) {
    const def = this.defs.get(id);
    if (!def) throw new Error(`<workspace-dock> has no palette widget "${id}"`);
    const p = name ? { widget: def.id, name } : { widget: def.id };
    if (this.tpl?.add(p) || !this.setTemplate('dock')) return;
    this.split(p);
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
  /** Shows the panels in template `id` (switching between templates compacts them; what does not fit is parked), or
   * back in the kept dock (as the template left it); false (and why, as dock:status) while an implementation's pod is being made. */
  setTemplate(id: TemplateId): boolean {
    const left = this.tpl, s = left?.state;
    if (!s && id === 'dock') return true;
    const all = s ? [...s.order.filter((p) => p !== null), ...s.parked] : panelsInOrder(this.kept.root);
    if (all.some(this.unnamed)) { this.say('Wait until every new pod is made.'); return false; }
    if (id !== 'dock') this.show(s ? relayout(s, id) : { template: id, ...place(all, TEMPLATES.find((x) => x.id === id)!.positions!), dock: this.kept });
    else { this.load(LayoutConfig.fromResolved(this.kept)); left!.backToDock(s!, this.requireLayout(), (p) => this.split(p)); }
    return true;
  }

  /** The layout to save: golden-layout's config (the kept one while a template shows), with `template` when one does. */
  arrangement(): { root?: unknown; template?: TemplateState } & Record<string, unknown> { return this.tpl ? { ...this.kept, template: this.tpl.state } : { ...this.kept }; }

  /** Fires `dock:connections`, for whatever wraps the dock (the wiring view). */
  connections() { this.dispatchEvent(new CustomEvent('dock:connections', { bubbles: true, composed: true })); }

  /** Ids of the panels currently open, in layout order. */
  openIds(): readonly string[] { return panelIds(this.kept.root as never); }

  private get storageKey(): string { const k = this.getAttribute('storage-key'); if (!k) throw new Error('<workspace-dock> needs a storage-key attribute to save layouts'); return k; }
  private get system(): string { return this.getAttribute('system') ?? 'host'; }
  private send(topic: string, payload: unknown) { this.requireBus().publish(topic, payload, 'workspace-dock'); }
  private say(message: string) { this.send('dock:status', { message }); }
  /** Panels or template changed: the controls re-read; the empty dock's `+` shows when nothing else does. */
  private changed() { const panels = this.openIds().length; this.empty!.hidden = !!this.tpl || panels > 0; this.send('dock:layout', { panels }); }
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
  /** A `+` in `parent` that opens the picker and splits `target()`'s panel (else as addWidget does) for the choice, focused. */
  private plus(parent: HTMLElement, className: string, target?: () => ComponentItem | undefined) {
    const b = parent.insertBefore(Object.assign(this.ownerDocument.createElement('button'), { type: 'button', className, textContent: '+', title: 'Add a panel' }), parent.firstChild);
    b.setAttribute('aria-label', 'Add a panel');
    b.addEventListener('click', () => void pick(b, { templates: this.templates }).then((p) => { const el = p && this.split(p, target?.()).container.element; if (el) { el.tabIndex = -1; el.focus(); } }));
    return b;
  }
  private get templates() { return [...this.querySelectorAll<HTMLTemplateElement>(':scope > template[data-widget]')]; }
  private split(p: PanelState, target?: ComponentItem) { return split(this.requireLayout(), p, p.name ?? this.defs.get(p.widget)?.title ?? p.widget, target); }
  /** Whether a stored template's panels are all in this palette; whether `p` is an implementation's panel whose pod is being made. */
  private known(t: TemplateState) { return [...t.order, ...t.parked].every((s) => !s || this.defs.has(s.widget)); }
  private unnamed = (p: PanelState) => !!this.defs.get(p.widget)?.template.dataset['implementation'] && !p.name;

  /** What mountPanel needs from the dock. */
  private get mounting() { return { doc: this.ownerDocument, defs: this.defs, bus: this.requireBus(), host: this.host, registry: this.registry, send: (t: string, p: unknown) => this.send(t, p) }; }
  /** golden-layout's config: the kept one while a template shows. */
  private get kept(): ResolvedLayoutConfig { return (this.tpl?.state.dock as ResolvedLayoutConfig | undefined) ?? this.requireLayout().saveLayout(); }

  /** Shows template state `s` in place of golden-layout (cleared), remembering it as it changes. */
  private show(s: TemplateState) {
    if (this.tpl) this.tpl.dispose(); else { this.requireLayout().clearComponentFocus(); this.requireLayout().clear(); }
    this.tpl = showTemplate(this.querySelector<HTMLElement>(':scope > .dock-area')!, s, { title: (p) => (p.widget === 'pod' ? p.name : this.defs.get(p.widget)?.title) ?? p.widget,
      mount: (el, st, item) => { mountPanel(item.container, st, this.mounting); for (const type of ['pointerdown', 'focusin']) el.addEventListener(type, () => this.reportFocus(item)); },
      pick: (anchor, hidden) => pick(anchor, { templates: this.templates, hidden }), bringBack: (to) => this.setTemplate(to),
      unnamed: this.unnamed, say: (m) => this.say(m), add: (p) => this.addWidget(p.widget, p.name),
      remember: (st) => { templateState(localStorage, this.storageKey).set(st); if (this.tpl) this.changed(); } });
    this.changed();
  }
  private requireLayout(): GoldenLayout { if (!this.layout) throw new Error('bug: workspace used before it was connected'); return this.layout; }
  private requireBus(): Bus { if (!this.bus) throw new Error('bug: workspace used before it was connected'); return this.bus; }
  /** Loads `config`, sized for the dock's tab bar. */
  private load(config: LayoutConfig) {
    const left = this.tpl; if (left) { left.dispose(true); this.tpl = null; templateState(localStorage, this.storageKey).set(null); this.reportFocus(); }
    this.requireLayout().clearComponentFocus();   // the focused panel is about to go: dock:focus null, not a stale panel
    this.requireLayout().loadLayout({ ...config, dimensions: { ...config.dimensions, headerHeight: HEADER_H } });
    if (left) this.changed();
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
    const saved = this.readSaved(); if (!saved) return this.say('No saved layout yet.');
    const t = templateState(localStorage, this.storageKey).get();   // load() clears it; re-entered, rebased, if its panels are the saved ones
    this.load(saved); this.say('Layout restored.'); const names = (o: (PanelState | null)[]) => JSON.stringify(o.filter((s) => s !== null).map((s) => s.name ?? s.widget).sort());
    if (t && this.known(t) && names([...t.order, ...t.parked]) === names(panelsInOrder(this.kept.root))) this.show({ ...t, dock: this.kept });
  }

  reset() { this.load(initial(this, this.defs)); this.say('Back to the starting layout.'); }
}

customElements.define('workspace-dock', WorkspaceDock);
