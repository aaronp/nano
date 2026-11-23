# In the host

A **host** is the page that loads your module, runs the Application and shows its pods. The nano app is one. It needs only a `nano.json`'s URL: from it, it loads each module in `modules` (relative to the `nano.json`) and adds the pods, runtimes and pipes to what it runs.

**Serve the build.** In the template, `bun run serve` builds `dist/` and serves it at `http://localhost:4000`, to any origin.

**Import it by URL.** In the nano app, File › Open…, paste `http://localhost:4000/nano.json` and Fetch. The dialog shows what will be added: the runtime `main` named `acme.template.main`, so it does not clash with the app's own `main`; where code from another origin comes from; and the Trust:

- **Sandboxed** (the default): each pod runs in an isolated frame. The calculator's view runs in its pod's frame and reaches only its own pod, so its history list stays empty, though the pipe still saves each result to the history pod.
- **Trusted**: the pods run in the page. Code from another origin asks once before it runs; then the view lists the history.

Import adds them; the dialog is the consent.

**Or with a link.** `?src=<url>` imports a `nano.json` on the app's own origin as the app opens, as the file is: no Trust choice, no renaming, so the template's pods run in the page, in `main`. "Open in nano" is such a link, to the template the nano app's own build copies:

<OpenInNano src="examples/template/nano.json"/>

**In your own project.** `bun run test-nano` (the template's script, from `@pritzlaff/nano-app`) serves the app and your project on loopback and opens your `nano.json` in it; File › Save writes the file back, and the page reloads when you rebuild.

**Place a pod.** The imported pods are listed in the explorer; double-click `calculator` to open its panel, in `<nano-calculator>`. A panel header's + (Add a panel) opens the picker: a `Runtime:` choice and each provider's implementations. Choosing `calculator` adds a new pod of it to that runtime. It works, but it has no pipe, so nothing saves its results, and with no history in its runtime its list stays empty.

## What happens when it runs

Open the calculator's panel, type 2, `+`, 3 and `=`: it shows `5`, and the history lists `2 + 3 = 5`. The import is kept in the app's document, so it is still there after a reload.

Next, [packaging](/learn/18-packaging): the build, and loading it from anywhere.
