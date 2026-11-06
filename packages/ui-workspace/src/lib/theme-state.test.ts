import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChoice } from './theme-state.ts';

test('stored theme choices parse strictly', () => {
  assert.deepEqual(parseChoice('terminal:dark'), { theme: 'terminal', mode: 'dark' });
  assert.equal(parseChoice('neon:dark'), null);
  assert.equal(parseChoice('enterprise:dim'), null);
  assert.equal(parseChoice(null), null);
});
