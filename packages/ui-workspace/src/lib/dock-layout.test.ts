import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countPanels, initialLayout, panelIds, readWidgetId, readWidgetName, panelState } from './dock-layout.ts';

const e = (id: string) => ({ id, title: id.toUpperCase() });

test('starting layouts follow the arrangement', () => {
  const one = initialLayout([e('notes')], 'grid');
  assert.equal(one.root!.type, 'component');
  const tabs = initialLayout([e('a'), e('b')], 'stack');
  assert.equal(tabs.root!.type, 'stack');
  const grid = initialLayout([e('a'), e('b'), e('c')], 'grid');
  assert.equal(grid.root!.type, 'row');
  assert.deepEqual(panelIds(grid.root), ['a', 'b', 'c']);
  assert.equal(countPanels(grid.root), 3);
  assert.deepEqual(initialLayout([], 'row'), { root: undefined });   // an empty workspace
  assert.deepEqual(panelIds(initialLayout([], 'grid').root), []);
});

test('panel state is strict so corrupt saved layouts fail loudly', () => {
  assert.equal(readWidgetId({ widget: 'chart' }), 'chart');
  assert.throws(() => readWidgetId({ widget: '<b>' }), /must be/);
  assert.throws(() => readWidgetId(null), /must be/);
  assert.throws(() => panelIds({ type: 'row', content: [{ type: 'component', componentState: {} }] }), /must be/);
});

test('a panel may name the instance its element shows; anything else is ignored', () => {
  assert.equal(readWidgetName({ widget: 'range', name: 'ex-range' }), 'ex-range');
  assert.equal(readWidgetName({ widget: 'range' }), undefined);
  assert.equal(readWidgetName({ widget: 'range', name: 42 }), undefined);
});

test('a saved panel names the instance its element shows, so Reset and Restore reattach to it', () => {
  assert.deepEqual(panelState('range', { model: 'range-3' }), { widget: 'range', name: 'range-3' });
  assert.deepEqual(panelState('notes', {}), { widget: 'notes' });
  assert.deepEqual(panelState('notes', null), { widget: 'notes' });
});
