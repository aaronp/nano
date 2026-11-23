/** Pure hash routing helpers for <app-shell>. */

/**
 * Which route to show for a location hash, given the declared paths. "*" is the not-found fallback.
 * An empty hash shows the first real route.
 */
export const resolveRoute = (hash: string, paths: readonly string[]): string => {
  const real = paths.filter((p) => p !== '*');
  const first = real[0];
  if (first === undefined) throw new Error('<app-shell> needs at least one <app-route path="/…">');
  const want = hash.replace(/^#/, '') || first;
  if (real.includes(want)) return want;
  if (paths.includes('*')) return '*';
  throw new Error(`no <app-route> matches ${want} and there is no path="*" fallback`);
};

/** An old bookmark's hash made a page's: `#/<id>` (`#/workspace` too) is `#/p/<id>` when `/p/<id>` is declared and `/<id>` is not (an app screen keeps its route). */
export const rewriteHash = (hash: string, paths: readonly string[]): string => {
  const want = hash.replace(/^#/, '');
  return want && !paths.includes(want) && paths.includes(`/p${want}`) ? `#/p${want}` : hash;
};

/** Is this nav link for the route being shown? */
export const isCurrent = (href: string | null, route: string): boolean => href === `#${route}`;
