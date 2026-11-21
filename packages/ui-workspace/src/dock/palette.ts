/**
 * <workspace-dock>'s palette: the widgets its `<template data-widget>` children name, the starting layout its `open`
 * and `arrangement` attributes give, and where a new panel goes: it splits the focused panel, else the largest.
 *
 *   const defs = readPalette(dock); layout.loadLayout(initial(dock, defs)); split(layout, { widget: 'notes' }, 'Notes')
 */
import { ResolvedComponentItemConfig, type ComponentItem, type ContentItem, type GoldenLayout, type JsonValue, type LayoutConfig, type Stack } from 'golden-layout/dist/esm/index.js';
import { ARRANGEMENTS, PALETTE_ID, initialLayout, type Arrangement, type PaletteEntry } from '../lib/dock-layout.ts';

export interface Def extends PaletteEntry { readonly template: HTMLTemplateElement }

/** The palette widgets of `el`'s own templates, by id; it needs at least one, each with a unique kebab-case id. */
export function readPalette(el: HTMLElement): Map<string, Def> {
  const defs = new Map<string, Def>();
  for (const t of el.querySelectorAll<HTMLTemplateElement>(':scope > template[data-widget]')) {
    const id = t.dataset['widget'] ?? '';
    if (!PALETTE_ID.test(id)) throw new Error(`<template data-widget="${id}"> needs a kebab-case id`);
    if (defs.has(id)) throw new Error(`duplicate workspace widget id ${id}`);
    defs.set(id, { id, title: t.dataset['title'] ?? id, template: t });
  }
  if (defs.size === 0) throw new Error('<workspace-dock> needs at least one <template data-widget="…">');
  return defs;
}

/** Each palette widget of `el` (its templates now): a pod's (`pod`, or one naming an implementation) or a tool's; undefined, not in its palette. */
export function widgetKinds(el: HTMLElement): (widget: string) => 'pod' | 'tool' | undefined {
  const of = new Map([...el.querySelectorAll<HTMLTemplateElement>(':scope > template[data-widget]')].map((t) => [t.dataset['widget']!, t.dataset['implementation'] ? 'pod' as const : 'tool' as const]));
  return (w) => (w === 'pod' ? 'pod' : of.get(w));
}

/** The starting layout: the widgets `open` names (else the first), arranged as `arrangement` says (else a row). */
export function initial(el: HTMLElement, defs: ReadonlyMap<string, Def>): LayoutConfig {
  const open = (el.getAttribute('open') ?? [...defs.keys()].slice(0, 1).join(',')).split(',').map((x) => x.trim()).filter(Boolean);
  const entries = open.map((id) => {
    const d = defs.get(id);
    if (!d) throw new Error(`<workspace-dock open="…"> names unknown widget "${id}"`);
    return d;
  });
  const arrangement = (el.getAttribute('arrangement') ?? 'row') as Arrangement;
  if (!ARRANGEMENTS.includes(arrangement)) throw new Error(`<workspace-dock arrangement> must be one of ${ARRANGEMENTS.join(', ')}`);
  const { root } = initialLayout(entries, arrangement);
  return { root: root as never, header: { popout: false } };
}

/** The stack with the largest area on screen, if any. */
const largestStack = (root: ContentItem | undefined): Stack | undefined => {
  let best: Stack | undefined, area = -1;
  const visit = (item: ContentItem) => {
    if (item.isStack) { const r = item.element.getBoundingClientRect(); if (r.width * r.height > area) { area = r.width * r.height; best = item as Stack; } }
    else item.contentItems.forEach(visit);
  };
  if (root) visit(root);
  return best;
};

/** Adds a `widget` panel of `state` splitting `panel` (else the focused one, else the largest): beside it as a new column
 * when that panel is wider than tall, else below it as a new row; into an empty dock, alone. Returns the new panel. */
export function split(layout: GoldenLayout, state: JsonValue, title: string, panel?: ComponentItem): ComponentItem {
  const target = (panel ?? layout.focusedComponentItem)?.parentItem ?? largestStack(layout.rootItem);
  if (!target?.isStack) return layout.newComponent('widget', state, title);   // an empty dock
  const { width, height } = target.element.getBoundingClientRect();
  // golden-layout's own drop onto a panel's right or bottom edge (internal API: nothing public splits a panel)
  const item = layout.createAndInitContentItem(ResolvedComponentItemConfig.createDefault('widget', state, title), target);
  const drop = target as unknown as { _dropSegment: string; onDrop(item: ContentItem, area: null): void };
  drop._dropSegment = width > height ? 'right' : 'bottom';
  drop.onDrop(item, null);
  return item as ComponentItem;
}
