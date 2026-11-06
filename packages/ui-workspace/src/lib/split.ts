/**
 * Pure maths for resizable split panes. Sizes are fractions of the available length that sum to 1.
 */

const EPS = 1e-9;

/** Turn weights like [1, 2] or "30,70" into fractions that sum to 1. Throws on bad input. */
export const normalise = (weights: readonly number[]): readonly number[] => {
  if (weights.length < 2) throw new Error(`a split needs at least two panes, got ${weights.length}`);
  if (weights.some((w) => !Number.isFinite(w) || w <= 0)) throw new Error(`pane sizes must be positive numbers, got ${weights.join(', ')}`);
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / total);
};

/** Parse a `sizes="30,70"` attribute; null means "equal sizes for `count` panes". */
export const parseSizes = (attr: string | null, count: number): readonly number[] => {
  if (attr === null || attr.trim() === '') return normalise(Array.from({ length: count }, () => 1));
  const parts = attr.split(',').map((x) => Number(x.trim()));
  if (parts.length !== count) throw new Error(`sizes="${attr}" lists ${parts.length} panes but the split has ${count}`);
  return normalise(parts);
};

/**
 * Move the divider after pane `i` by `delta` (a fraction of the whole; positive grows pane i).
 * Only the two neighbours change, and neither goes below `min` (also a fraction).
 */
export const resizeAt = (sizes: readonly number[], i: number, delta: number, min: number): readonly number[] => {
  const a = sizes[i], b = sizes[i + 1];
  if (a === undefined || b === undefined) throw new Error(`bug: no divider after pane ${i} of ${sizes.length}`);
  if (min < 0 || min * sizes.length > 1 + EPS) throw new Error(`min ${min} is impossible for ${sizes.length} panes`);
  /* pane i may shrink until it reaches min, pane i+1 likewise; panes already below min never shrink further */
  const lower = Math.min(min - a, 0), upper = Math.max(b - min, 0);
  const d = Math.max(lower, Math.min(upper, delta));
  return sizes.map((s, k) => (k === i ? a + d : k === i + 1 ? b - d : s));
};

/** Pixels → fraction for a container `length` px long, after removing the dividers' width. */
export const pxToFraction = (px: number, length: number, dividers: number, dividerPx: number): number => {
  const usable = length - dividers * dividerPx;
  if (usable <= 0) return 0;
  return px / usable;
};

/** Sizes as a CSS grid track list, with fixed-width divider tracks in between. */
export const gridTracks = (sizes: readonly number[], dividerPx: number): string =>
  sizes.map((s) => `minmax(0, ${(s * 100).toFixed(4)}fr)`).join(` ${dividerPx}px `);
