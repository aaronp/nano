# ui-workspace

A host site made from the [workspace shell starter](../../shell-starters/workspace), hosting `@composable` components.
Everything that joins the two is in `src/composable.ts` (one scope provided on the document; our publications
mirrored to the starter's bus as `composable:<op>`) and a few lines at the end of `public/app.css` (our `--c-*`
theme tokens mapped onto the starter's). The components and the starter otherwise know nothing about each other.

- **Build time:** `<flow-slider name="slider">` on the Overview page places itself in the scope when the page loads.
- **Runtime:** the drawer's *(composable)* entries add panels to the Workspace dock; each panel places a new
  instance and removes it when closed. *Log (composable)* shows everything in the scope; the starter's *Activity*
  shows the mirrored `composable:*` topics.

`bun run build` (then `bun run serve`) builds `public/main.js` with Bun instead of esbuild. The rest of this
README is the starter's.

# Workspace starter

The [app starter](../app) plus a **Workspace** page: a [golden-layout](https://golden-layout.github.io/golden-layout/) dock where people arrange widgets as tabbed, resizable, dockable panels. The widgets are listed under *Workspace* in the navigation drawer: click one to add it, or drag it straight into the layout where you want it. Built with Lit web components and TypeScript, bundled with esbuild. Copy this folder and make it yours.

## Run it

```sh
npm install          # or: bun install
npm run build        # bundles src/ into public/main.js
npx serve public     # or: bunx serve public
```

`npm run dev` rebuilds on every change. `npm test` runs the unit tests, `npm run typecheck` runs `tsc --strict`.

## The workspace

In `public/index.html`:

```html
<!-- drawer: one sub-item per widget, right after the Workspace link -->
<a slot="nav" href="#/workspace">Workspace</a>
<a slot="nav" data-sub href="#/workspace" data-dock-add="workspace" data-widget="notes">+ Notes</a>

<!-- page: one <template> per widget -->
<app-route path="/workspace" bleed>
  <workspace-dock id="workspace" storage-key="my-app.layout" open="notes,chart" arrangement="grid">
    <template data-widget="notes" data-title="Notes"><notes-panel></notes-panel></template>
  </workspace-dock>
</app-route>
```

- `open` lists the panels shown at first; `arrangement` is `row`, `column`, `stack` (tabs) or `grid`.
- Each panel is a fresh copy of its template, and every panel is on the app's event bus.
- **Save layout** remembers the arrangement in this browser and it opens automatically next time; **Restore** goes back to it and **Reset** to the starting layout. A saved layout that names widgets you have since removed is ignored, with a message.
- `data-flush` on a template removes the panel padding (for charts and lists that draw their own edges).

Everything else (themes, `<split-pane>`, the event bus, adding pages) works as in the app starter; see its README.

## Files

```
src/components/workspace-dock.ts  the golden-layout dock, styled with the theme tokens
src/lib/dock-layout.ts            pure helpers: starting layouts, panel ids, validation (tested)
src/widgets/notes-panel.ts        a scratch-pad widget
(everything else as in the app starter)
```
