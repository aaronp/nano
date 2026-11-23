# Packaging

A host needs two files from you: the module and the `nano.json` that names it. The template builds both and publishes them as a website, so anyone can load your pods by one URL.

**Build.** In the template, `bun run build` writes `dist/`:

- `dist/index.js`, the module: the provider as its default export, `views`, and the views' custom elements. nano's packages, `lit` and `typebox` are left as bare imports for the host to provide, so a page holds one copy of each however many modules it loads.
- `dist/nano.json`, the template's `nano.json`, its `modules` naming `./index.js`:

<<< @/../templates/nano-template/nano.json

With `PUBLIC_URL` set to where `dist/` will be served, the build writes the module's full address instead of `./index.js`, so a downloaded copy of the `nano.json` still finds its module.

**The template as its own repository.** The template lives in the nano repository, tested against the packages it ships with. When it changes on `master`, a workflow (`template-export.yml`) tests and builds it, then copies it to its own repository, `nano-template`: a GitHub template to start from ("Use this template").

**Publish.** That repository's `pages.yml` runs the tests, builds with `PUBLIC_URL` set, and publishes `dist/` to GitHub Pages. The app's URL is then:

```
https://<owner>.github.io/<repo>/nano.json
```

## What happens when it runs

In the nano app, File › Open…, paste that URL and Fetch; choose Sandboxed or Trusted and Import, as in [the host](/learn/17-host). The code comes from another origin, so the dialog lists it before anything runs.

That is the calculator from plain TypeScript to a component anyone can load. For more, see the [recipes](/recipes/pipeline).
