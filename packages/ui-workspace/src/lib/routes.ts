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

/** Is this nav link for the route being shown? (The shell never marks links that add something, data-dock-add.) */
export const isCurrent = (href: string | null, route: string): boolean => href === `#${route}`;
