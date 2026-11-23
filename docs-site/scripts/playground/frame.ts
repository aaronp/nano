/** Where the host's shared modules live: the origin plus the docs `base` without its trailing `docs/`, plus `shared/`. */
export const sharedBase = (origin: string, base: string) => `${origin}${base.replace(/docs\/$/, '')}shared/`

// JSON inside HTML: nothing can open a tag or comment.
const safe = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')

/**
 * The sandboxed frame's document. The reader's code runs inline in a module script after the import map, so it needs no
 * blob:/data: URL (an opaque origin may not load one) and its own `export`s are harmless. `main` is called from the same
 * module scope. A failed import (shared modules not built) fires `error` on the script element, so a capturing listener
 * posts it; its text starts with `import failed`, which the page maps to the "build the host first" hint.
 */
export const frameDoc = (js: string, shared: string, run: string) => {
  const map = { imports: { '@pritzlaff/nano-core': `${shared}nano-core.js`, typebox: `${shared}typebox.js`, 'typebox/value': `${shared}typebox-value.js` } }
  const code = js.replace(/<(\/script|!--)/gi, '<\\$1')
  return `<!doctype html><meta charset="utf-8"><script>
const run = ${safe(run)}, __post = (kind, text) => parent.postMessage({ run, kind, text }, '*')
const msg = e => String(e && e.message || e)
addEventListener('error', e => e.target && e.target !== window ? __post('error', 'import failed: ' + (e.target.src || 'module')) : __post('error', msg(e.error || e.message)), true)
addEventListener('unhandledrejection', e => __post('error', msg(e.reason)))
</script><script type="importmap">${safe(map)}</script><script type="module">
${code}
;(async () => { try { await main(line => __post('line', String(line))); __post('done') } catch (e) { __post('error', msg(e)) } })()
</script>`
}
