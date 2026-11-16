/** Hash routing: which of the declared paths a location hash shows ("*" is the not-found page; an empty hash shows the first). */
export const resolveRoute = (hash: string, paths: readonly string[]): string => {
  const real = paths.filter(p => p !== '*'), want = hash.replace(/^#/, '') || real[0]
  if (want === undefined) throw new Error('<app-shell> needs at least one <app-route path="/…">')
  if (real.includes(want)) return want
  if (paths.includes('*')) return '*'
  throw new Error(`no <app-route> matches ${want} and there is no path="*" fallback`)
}
