/**
 * <workspace-dock>'s styles, once per document: golden-layout's base CSS, then the dock's (plain text tabs, the
 * Clear window style, the icons as CSS variables).
 *
 *   ensureStyles(document)
 */
import baseCss from 'golden-layout/dist/css/goldenlayout-base.css';

const STYLE_ID = 'workspace-dock-styles';
/** The tab bar's height: the CSS draws it, and golden-layout must size panels for it too (saved layouts included). */
export const HEADER_H = 30;
const DOCK_CSS = `
workspace-dock { display: grid; grid-template-rows: minmax(0, 1fr); height: 100%; background: var(--bg); color: var(--fg); font: 14px var(--font); }
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
/* the title is an inline-block with overflow hidden, whose baseline is its bottom edge: centre it as a flex item instead */
.lm_header .lm_tab { display: flex; align-items: center; height: 28px; line-height: 28px; padding: 0 22px 0 8px; font: 12px var(--font); color: var(--muted); background: none; border: 0; border-radius: 0; box-shadow: none; }
.lm_header .lm_tab:hover { color: var(--fg); }
.lm_header .lm_tab.lm_active { color: var(--fg); background: none; font-weight: 600; box-shadow: inset 0 -2px 0 var(--accent); }
.lm_header.lm_focused .lm_tab.lm_active { color: var(--accent); }
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
/* a header's + (the picker) before maximise and close; an empty dock's one large + */
.lm_controls > .dock-split { width: auto; height: 11px; padding: 0; font: 16px/11px var(--font); color: var(--muted); background: none; border: 0; cursor: pointer; }
.lm_controls > .dock-split:hover { color: var(--fg); }
.dock-empty { position: absolute; inset: 0; z-index: 1; overflow: auto; padding: 12px; box-sizing: border-box; background: var(--bg); }
.dock-empty[hidden] { display: none; }
/* Clear: a stack with one panel has no tab bar; its maximise and close float over it on hover.
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

export const ensureStyles = (doc: Document) => {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `:root { --icon-close: ${icon('<path d="M2 2l8 8M10 2l-8 8"/>')}; --icon-max: ${icon('<rect x="1.5" y="1.5" width="9" height="9"/>')}; --icon-min: ${icon('<path d="M2 9.5h8"/>')}; }\n${baseCss}\n${DOCK_CSS}`;
  doc.head.append(style);
};
