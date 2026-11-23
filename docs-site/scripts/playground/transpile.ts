import { transform } from 'sucrase'

/** TypeScript to JavaScript, ESM kept (imports resolve through the frame's import map). */
export const transpile = (ts: string): { ok: true; js: string } | { ok: false; error: string } => {
  try {
    return { ok: true, js: transform(ts, { transforms: ['typescript'] }).code }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
