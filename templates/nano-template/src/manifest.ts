// The manifest: what a host reads (from the URL it is given) before importing this package's module.
import type { Catalog } from '@pritzlaff/nano-elements'

/** The packages a host provides to what it imports; the module leaves them as bare imports. */
export const SHARED = ['@pritzlaff/nano-core', '@pritzlaff/nano-runes', '@pritzlaff/nano-elements', 'lit', 'typebox']

/** Manifest version 1. `module` is relative to the manifest's URL; the module itself is the authority. */
export type Manifest = {
  manifest: 1; name: string; version: string; module: './index.js'
  /** The version ranges of the shared packages this package was built against. */
  shared: Record<string, string>
  components: { kind: string; id: string; title: string; tag?: string; ops: { name: string; input: boolean; output: boolean }[] }[]
}

/** The manifest for a catalog, from the package.json it is built from. */
export function manifestOf(catalog: Catalog, pkg: { name: string; version: string; dependencies?: Record<string, string> }): Manifest {
  const deps = pkg.dependencies ?? {}
  return {
    manifest: 1, name: pkg.name, version: pkg.version, module: './index.js',
    shared: Object.fromEntries(SHARED.filter(p => p in deps).map(p => [p, deps[p]!])),
    components: Object.entries(catalog).map(([kind, e]) => ({
      kind, id: `${e.component.id.ns}/${e.component.id.name}`, title: e.title, ...(e.tag ? { tag: e.tag } : {}),
      ops: [...e.component.actions.values()].map(({ op }) => ({ name: op.name, input: op.input !== undefined, output: op.output !== undefined })),
    })),
  }
}
