import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus, matches } from './bus.ts';
import { areaPath, changePct, linePath, parseValues, scalePoints } from './chart.ts';
import { resolveRoute, isCurrent } from './routes.ts';
import { gridTracks, normalise, parseSizes, pxToFraction, resizeAt } from './split.ts';
import { THEMES, THEME_IDS, TOKEN_NAMES, resolveScheme, schemesOf, themeVars } from './themes.ts';

const close = (a: readonly number[], b: readonly number[]) => a.forEach((x, i) => assert.ok(Math.abs(x - (b[i] ?? NaN)) < 1e-9, `${a} vs ${b}`));

test('every theme scheme defines every token', () => {
  for (const id of THEME_IDS) {
    assert.ok(schemesOf(id).length > 0, id);
    for (const s of schemesOf(id)) {
      const vars = themeVars(id, s);
      for (const t of TOKEN_NAMES) assert.ok(vars[`--${t}`], `${id}/${s} lacks --${t}`);
    }
  }
});

test('scheme resolution honours the choice, then the OS, then the only scheme', () => {
  assert.equal(resolveScheme('enterprise', 'system', true), 'dark');
  assert.equal(resolveScheme('enterprise', 'system', false), 'light');
  assert.equal(resolveScheme('enterprise', 'light', true), 'light');
  assert.equal(resolveScheme('terminal', 'light', false), 'dark');
  assert.equal(resolveScheme('sketch', 'dark', true), 'light');
  assert.throws(() => themeVars('terminal', 'light'), /no light scheme/);
  assert.ok(THEMES.enterprise.fonts.length > 0);
});

test('split sizes normalise, parse and reject bad input', () => {
  close(normalise([1, 3]), [0.25, 0.75]);
  close(parseSizes('30,70', 2), [0.3, 0.7]);
  close(parseSizes(null, 4), [0.25, 0.25, 0.25, 0.25]);
  assert.throws(() => parseSizes('1,2,3', 2), /lists 3 panes/);
  assert.throws(() => normalise([1]), /at least two/);
  assert.throws(() => normalise([1, -1]), /positive/);
});

test('resizing moves only the two neighbours and respects the minimum', () => {
  close(resizeAt([0.25, 0.25, 0.5], 1, 0.1, 0.1), [0.25, 0.35, 0.4]);
  close(resizeAt([0.5, 0.5], 0, 0.9, 0.1), [0.9, 0.1]);
  close(resizeAt([0.5, 0.5], 0, -0.9, 0.1), [0.1, 0.9]);
  close(resizeAt([0.05, 0.95], 0, -0.1, 0.1), [0.05, 0.95]);
  const r = resizeAt([0.2, 0.3, 0.5], 0, 0.05, 0.1);
  assert.ok(Math.abs(r.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.throws(() => resizeAt([0.5, 0.5], 1, 0.1, 0.1), /no divider/);
  assert.equal(pxToFraction(100, 1008, 1, 8), 0.1);
  assert.equal(gridTracks([0.5, 0.5], 8), 'minmax(0, 50.0000fr) 8px minmax(0, 50.0000fr)');
});

test('routes: empty hash shows the first route, unknown goes to *', () => {
  assert.equal(resolveRoute('', ['/', '/inbox', '*']), '/');
  assert.equal(resolveRoute('#/inbox', ['/', '/inbox', '*']), '/inbox');
  assert.equal(resolveRoute('#/nope', ['/', '/inbox', '*']), '*');
  assert.throws(() => resolveRoute('#/nope', ['/']), /no <app-route>/);
  assert.throws(() => resolveRoute('', ['*']), /at least one/);
  assert.equal(isCurrent('#/inbox', '/inbox'), true);
});

test('bus: patterns, ordering, history limit and bad topics', () => {
  assert.ok(matches('*', 'a:b') && matches('mail:*', 'mail:open') && !matches('mail:*', 'file:open') && matches('x', 'x'));
  const bus = createBus({ historyLimit: 2 });
  const seen: string[] = [];
  const off = bus.subscribe('mail:*', (m) => seen.push(`${m.seq}:${m.topic}`));
  bus.publish('mail:open', {}, 't'); bus.publish('file:open', {}, 't'); off(); bus.publish('mail:folder', {}, 't');
  assert.deepEqual(seen, ['1:mail:open']);
  assert.deepEqual(bus.history().map((m) => m.seq), [2, 3]);
  assert.throws(() => bus.publish('a:*', {}, 't'), /cannot publish/);
  assert.throws(() => createBus({ historyLimit: -1 }), /non-negative/);
});

test('chart geometry spans the box and parses values strictly', () => {
  const pts = scalePoints([1, 3, 2], 100, 50, 5);
  assert.deepEqual(pts[0], { x: 5, y: 45 });
  assert.deepEqual(pts[1], { x: 50, y: 5 });
  assert.match(linePath(pts), /^M5\.0 45\.0 L50\.0 5\.0/);
  assert.match(areaPath(pts, 50), /Z$/);
  assert.deepEqual(parseValues('1, 2,3'), [1, 2, 3]);
  assert.throws(() => parseValues('1,x'), /comma-separated/);
  assert.equal(changePct([100, 125]), 25);
  assert.throws(() => scalePoints([1], 10, 10, 0), /at least two/);
});
