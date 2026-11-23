# In the host

A **host** is the page that loads your module, runs the application and shows its pods. The nano app is one. It needs only the build's `nano.json` URL: from that it finds the module (`modules`, relative to the `nano.json`), loads it, and adds the pods, runtimes and pipes to what it already runs.

**Serve the build.** In the template:

```sh
bun run serve    # builds dist/, then serves it at http://localhost:4000
```

It lets any origin fetch the files, so the nano app can import `http://localhost:4000/nano.json` from wherever it runs.

**Import it by URL.** In the nano app, File › Open…, paste the `nano.json` URL and Fetch. The dialog shows what will be added: the runtime's name (the template's `main` lands as `acme.template.main`, so it doesn't clash with yours), where code from another site comes from, and a choice of **Sandboxed** (each pod runs in a frame apart from the page, the default) or **Trusted** (the pods run in the page itself). Import adds them.

**Or with a link.** `?src=<url>` imports a `nano.json` as the app opens. The `nano.json` must be on the app's own origin; code it names from other sites still asks for your approval before it is loaded. The parameter is removed from the address bar once the import succeeds, so a reload doesn't import twice. "Open in nano" on these pages is such a link:

<OpenInNano src="examples/template/nano.json"/>

**Place a pod on a page.** The imported pods are listed in the explorer; double-click one to open its panel, showing it in its view. To add another pod, press a panel header's + (Add a panel): the picker lists each provider's implementations, and choosing one (say `timer`) adds a new pod of it to the runtime you pick and opens its panel.

**When it runs:** the timer's panel shows `<nano-timer>`; Start makes it count. The import is saved with the app's own document, so it is there after a reload.

The model's definition: `design.md` ("Views and layout") in the nano repository.
