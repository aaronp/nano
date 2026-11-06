/** Pure geometry for the small charts in the example widgets. */

export interface Point { readonly x: number; readonly y: number }

/** Scale values into a w×h box (y grows downward), leaving `pad` px inside each edge. */
export const scalePoints = (values: readonly number[], w: number, h: number, pad: number): readonly Point[] => {
  if (values.length < 2) throw new Error(`a line chart needs at least two values, got ${values.length}`);
  if (values.some((v) => !Number.isFinite(v))) throw new Error(`chart values must be numbers, got ${values.join(', ')}`);
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = (w - pad * 2) / (values.length - 1);
  return values.map((v, i) => ({ x: pad + i * step, y: pad + (h - pad * 2) * (1 - (v - lo) / span) }));
};

/** SVG path for a polyline through the points. */
export const linePath = (pts: readonly Point[]): string =>
  pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

/** SVG path for the area under the line, closed along the bottom edge `h`. */
export const areaPath = (pts: readonly Point[], h: number): string => {
  const first = pts[0], last = pts[pts.length - 1];
  if (!first || !last) throw new Error('bug: area of an empty line');
  return `${linePath(pts)} L${last.x.toFixed(1)} ${h} L${first.x.toFixed(1)} ${h} Z`;
};

/** Parse values="3,5,4" into numbers; throws on anything that isn't a number. */
export const parseValues = (attr: string): readonly number[] => {
  const vs = attr.split(',').map((x) => Number(x.trim()));
  if (vs.some((v) => !Number.isFinite(v))) throw new Error(`values="${attr}" must be comma-separated numbers`);
  return vs;
};

/** Percentage change from the first to the last value, rounded to one decimal. */
export const changePct = (values: readonly number[]): number => {
  const a = values[0], b = values[values.length - 1];
  if (a === undefined || b === undefined || a === 0) throw new Error('change needs a non-zero first value');
  return Math.round(((b - a) / Math.abs(a)) * 1000) / 10;
};
