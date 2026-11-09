# Import components from a URL — design

## Intent

A package of components built from the template (or anything that builds the same way) is published as a module
plus a `manifest.json`. Pasting the manifest's URL into the host imports it: its components then appear in the
components drawer and the platform's catalog, and wire up like the bundle's. Trusted for now (the module runs in
the page); an iframe sandbox comes later and uses the same manifest.

## Goals

1. **Shared libraries come from the host.**
   - The workspace build puts `@pritzlaff/nano-core`, `nano-runes`, `nano-elements`, `lit` (with its subpaths) and
     `typebox` (with `typebox/value` and other subpaths it uses) into **shared module files** under
     `public/shared/`, and `main.js` imports them from there (externals), so there is one copy of each.
   - `index.html` carries an **import map** naming those files for the bare specifiers, so an imported module's
     `import … from '@pritzlaff/nano-core'` gets the host's copy.
2. **The Import dialog** (the drawer's Import button, now enabled):
   - **Step 1:** a URL field. The host fetches it as JSON and checks it is a version-1 manifest (`manifest: 1`,
     `name`, `version`, `module`, `components` each with `kind`, `id`, `title`, and `tag` if it has an element).
   - **Step 2, the preview:** the package name and version, the resolved module URL, each component (title, kind,
     id, tag, and its ops as in → out), and the **shared** ranges checked against the versions the host provides:
     each compatible one is ticked; an incompatible one is a warning.
   - **Refused (Import disabled, with the reason):** not a manifest; a component id, kind or element tag that
     clashes with one already loaded (from the host or another import); the module fails to load.
   - **Import:** loads the module (`import()` of the module URL resolved against the manifest's URL), calls its
     `define()`, and adds its `catalog` to the host: the platform's catalog (so `create-component` can make them),
     the docks' palettes (a panel template per entry with a tag), and the drawers (an **Imported** section, grouped
     by package).
3. **Imports are remembered** (local storage: manifest URL, name, version) and **loaded at start-up**, before the
   docks restore their layouts, so saved panels of imported kinds come back. One that fails to load is skipped, with
   a message in the drawer's Imported section.
4. **Managing imports:** in the drawer, each imported package's heading has a **remove** (✕). Removing forgets it;
   its components stay loaded until the page reloads (a custom element can't be undefined). **Re-importing** a URL
   already imported replaces the record; a newer version takes effect after a reload (the browser keeps the module
   it loaded), which the dialog says.

## Non-goals

- The iframe sandbox; signatures or allow-lists; imports from npm by name.
- Updating a loaded package without a reload.

## Anti-goals

- A second copy of core, runes, elements, lit or typebox in the page.
- The host knowing particular packages: everything comes from the manifest and the module's `catalog`.
- A file over ~200 lines.

## Settled by Claude (check these)

- **The manifest is checked by hand** (a small validator), not with a schema library.
- **Clashing kinds aren't renamed or namespaced:** a clash is refused, which is simpler and visible; the package's
  author renames (the template's README says to).
- **The module must export `catalog` and `define`**; one that doesn't is refused after loading, and nothing is added.
- **Panels of a removed package** keep working until reload; after a reload their panels can't be restored and the
  dock says so (its existing "saved layout ignored" message).
- **Version checks** use a small caret/tilde/exact range matcher for the `shared` ranges (no semver library).
- **The first real test is the template's own build:** `templates/nano-template`'s `dist/` served locally (or its
  Pages URL once exported) imported into the workspace.
- **The host's provided versions** are written at build time (`public/shared/versions.json`) from the workspace
  packages' and the installed `lit`/`typebox` package.json versions.
- **The module's `catalog` is the authority; the manifest is the preview.** Clash checks run on the manifest before
  loading, and again on the loaded `catalog`; a catalog that doesn't match its manifest (kinds or tags) is refused
  before `define()` runs.
- **The module loads only on Import** (loading can't be undone). A load failure, or a module without `catalog` and
  `define`, is shown in the dialog and nothing is added.
- **Adding to a running host:** `composable.ts` exposes `addCatalog(entries)`: it extends the platform's catalog
  object in place, gives every dock a panel template per entry (a new public `addTemplate` on the dock), and fires a
  `catalog:changed` document event; drawers rebuild their Imported section on it. Start-up imports are awaited
  (each failure caught) before the docks are defined, so restored panels find their templates.
- **Shared files come from one build with code splitting:** `main.ts` and one small entry per shared specifier
  (`export * from '<specifier>'`) build together, so lit's and typebox's internals land in common chunks once. The
  specifiers are enumerated: the five packages, `typebox/value`, and lit's `decorators.js`, `directive.js` and the
  directives the template and bundle use; the template's README lists them as what a package may import.
- **Cross-origin imports work when the server allows them** (GitHub Pages does). The template's preview server sends
  `Access-Control-Allow-Origin: *`, so the first test imports from it on another port.
- **Clashes are checked against what is loaded:** the host's catalog and the imports loaded so far (not records of
  imports that failed to load).
