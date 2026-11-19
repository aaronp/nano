import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus, matches } from './bus.ts';
import { areaPath, changePct, linePath, parseValues, scalePoints } from './chart.ts';
import { resolveRoute, isCurrent } from './routes.ts';
import { THEMES, THEME_IDS, TOKEN_NAMES, resolveScheme, schemesOf, themeVars } from './themes.ts';


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
// BACKLOG(9): the needs tests (nextName, unboundLabel, optionsFor) are in retired/test/needs-lib.test.ts.
