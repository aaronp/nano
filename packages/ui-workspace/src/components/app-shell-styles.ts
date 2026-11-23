// <app-shell>'s styles: the app bar, the drawer (persistent, rail or modal) and the content area.
import { css } from 'lit';

export const appShellStyles = css`
    /* one column, never wider than the window: an auto column grew to the bar's content (a focused pod's controls) and
       widened the whole page. A focused pod's controls give way first (boot-app-bar.ts); past that the bar clips,
       sideways only (clip, not hidden: its menus still drop below it), and keeps one row, so its height never moves
       the page when a pod's controls come and go */
    :host { --drawer-w: 248px; display: grid; grid-template-rows: auto minmax(0, 1fr); grid-template-columns: minmax(0, 1fr); height: 100vh; height: 100dvh; background: var(--bg); color: var(--fg);
      font: 15px/1.5 var(--font); }
    .bar { position: relative; z-index: 1001; display: flex; align-items: center; overflow-x: clip; gap: 10px; min-height: 56px; padding: 0 12px 0 0; background: var(--appbar-bg); color: var(--appbar-fg);
      border-bottom: 1px solid var(--line); }
    /* the bar's colour reaches what's slotted in it (the File menu, the view's controls): their own :host rules (a
       shared base sets color: --nano-fg) lose to this outer one, so nothing in the bar takes the page's text colour */
    .bar ::slotted(*) { color: inherit; }
    .bar ::slotted([slot='title']) { flex: 0 1 auto; min-width: 0; margin: 0; font: 600 18px/1.2 var(--display); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* the menu button and title sit over the drawer and take its width, so the page heading lines up with the content */
    .brand { flex: none; align-self: stretch; display: flex; align-items: center; gap: 10px; box-sizing: border-box; width: var(--drawer-w); padding-left: 12px;
      margin-right: 10px; border-right: 1px solid var(--line); overflow: hidden; transition: width .2s ease; }
    :host([narrow]) .brand { width: auto; padding-right: 14px; }
    :host([collapsed]:not([narrow])) .brand ::slotted([slot='title']) { display: none; }
    .page { flex: none; display: flex; align-items: center; gap: 10px; margin-right: 24px; font: 600 16px/1.2 var(--display); white-space: nowrap; }
    .page .tile { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: var(--accent); color: var(--on-accent); }
    .page svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .spacer { flex: 1; }
    .menu { flex: none; width: 44px; height: 44px; border: 0; border-radius: var(--radius); background: transparent; color: inherit; display: grid; place-items: center; cursor: pointer; }
    .menu:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
    button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .frame { isolation: isolate; display: grid; grid-template-columns: auto minmax(0, 1fr); min-height: 0; }
    .content { display: grid; grid-template-rows: minmax(0, 1fr) auto; min-width: 0; min-height: 0; }
    main { overflow: auto; padding: 24px; min-height: 0; }
    ::slotted(app-route) { display: block; }
    ::slotted(app-route[hidden]) { display: none; }
    ::slotted(app-route[bleed]) { margin: -24px; height: calc(100% + 48px); }
    :host([collapsed]:not([narrow])) { --drawer-w: 68px; }
    footer { padding: 6px 16px; border-top: 1px solid var(--line); background: var(--surface); color: var(--muted); font-size: 13px; }
    .drawer { display: flex; flex-direction: column; gap: 2px; width: var(--drawer-w); box-sizing: border-box; padding: 12px 10px; background: var(--drawer-bg);
      border-right: 1px solid var(--line); overflow: auto; overflow-x: hidden; transition: width .2s ease; }
    /* the rail: items keep their place and the drawer's edge clips their labels, so the icons stay put as it slides */
    :host([collapsed]:not([narrow])) .drawer ::slotted([slot='nav']) { overflow: hidden; }
    :host([collapsed]:not([narrow])) .drawer ::slotted([slot='nav'][data-sub]) { padding: 9px 14px; }
    :host([collapsed]:not([narrow])) .drawer ::slotted([slot='drawer-footer']) { visibility: hidden; }
    @media (prefers-reduced-motion: reduce) { .drawer, .brand { transition: none; } }
    nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
    ::slotted([slot='nav']) { display: flex; align-items: center; gap: 12px; padding: 9px 14px; border-radius: var(--radius); color: inherit; text-decoration: none; white-space: nowrap; }
    ::slotted([slot='nav']:hover) { background: var(--surface-2); }
    ::slotted([slot='nav']:focus-visible) { outline: 2px solid var(--focus); outline-offset: 1px; }
    ::slotted([slot='nav'][aria-current='page']) { background: var(--accent-soft); color: var(--fg); font-weight: 600; }
    ::slotted([slot='nav'][data-sub]) { padding: 5px 14px 5px 44px; font-size: 14px; color: var(--muted); }
    ::slotted([slot='nav'][data-sub]:hover) { color: var(--fg); }
    dialog { margin: 0; padding: 0; border: 0; height: 100%; max-height: 100%; width: min(300px, 86vw); background: var(--drawer-bg); color: var(--fg); }
    dialog .drawer { width: 100%; height: 100%; border: 0; }
    dialog::backdrop { background: rgb(0 0 0 / .45); }
    dialog[open] { animation: slide .2s ease-out; }
    @keyframes slide { from { transform: translateX(-100%); } }
    @media (prefers-reduced-motion: reduce) { dialog[open] { animation: none; } }
  `;
