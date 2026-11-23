# Packaging and publishing

A host needs two files from you: the module and the `nano.json` that names it. The template builds both and publishes them as a website, so anyone can load your pods by one URL.

**Build.** In the template:

```sh
bun run build    # dist/index.js and dist/nano.json
```

- `dist/index.js` is the module: the provider as its default export, `views` (each implementation's tag), and the views' custom elements. nano's packages, `lit` and `typebox` are left as imports for the host to provide, so a page holds one copy of each however many modules it loads.
- `dist/nano.json` is the template's `nano.json`, its `modules` pointing at `./index.js`:

<<< @/../templates/nano-template/nano.json

With `PUBLIC_URL` set to where `dist/` will be served, the build writes that address in full instead of `./index.js`, so a downloaded copy of `nano.json` still finds its module.

**The template as its own repository.** The template lives in the nano repository, where it is tested against the libraries it ships with. When it changes there, a workflow (`template-export.yml`) tests and builds it, then copies it to its own repository, `nano-template`, a GitHub template you can start from ("Use this template").

**Publish.** That repository's `pages.yml` runs the tests, builds with `PUBLIC_URL` set, and publishes `dist/` to GitHub Pages. Your app's address is then:

```
https://<owner>.github.io/<repo>/nano.json
```

**When it runs:** in the nano app, File › Open…, paste that address and Fetch; choose Sandboxed or Trusted and Import ([In the host](/concepts/host), [Isolation](/concepts/isolation)). The template copied here, built by the nano app's own build, opens the same way:

<OpenInNano src="examples/template/nano.json"/>

The model's definition: `design.md` (`AppDeployment`, its `modules`) in the nano repository.
