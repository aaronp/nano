// From src/lib/lib.test.ts at 35f1675^: boot-needs (retired, BACKLOG(9)).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextName, optionsFor, unboundLabel } from '../src/boot-needs.ts';

test('a made instance takes the first free <kind>-<n>', () => {
  assert.equal(nextName('people-db', new Set()), 'people-db-1');
  assert.equal(nextName('people-db', new Set(['people-db-1', 'people-db-3'])), 'people-db-2');
});

test('a disabled panel says what it needs', () => {
  assert.equal(unboundLabel(['db']), 'Needs db — Choose…');
  assert.equal(unboundLabel(['bff', 'rules']), 'Needs bff, rules — Choose…');
});

test('the chooser offers fitting instances in every system, and kinds that implement the interface', () => {
  const inst = (id: string, ops: string[]) => ({ id, component: 'x/y', ops: ops.map((k) => ({ ns: k.slice(0, k.lastIndexOf('/')), name: k.slice(k.lastIndexOf('/') + 1) })) as never });
  const snaps = [
    { id: 'app', instances: [inst('form', ['example/bff/save']), inst('half', ['example/bff/save'])], subscriptions: [], bindings: [] },
    { id: 'bff', instances: [inst('bff', ['example/bff/save', 'example/bff/find']), inst('other', ['x/y'])], subscriptions: [], bindings: [] },
  ];
  const kinds = [{ kind: 'people-bff', implements: ['example/bff'] }, { kind: 'person-form' }];
  assert.deepEqual(optionsFor({ id: 'example/bff', ops: ['example/bff/save', 'example/bff/find'] }, 'instance:app/form', snaps, kinds),
    { candidates: ['instance:bff/bff'], kinds: ['people-bff'] });
  // the requester itself is never offered
  assert.deepEqual(optionsFor({ id: 'example/bff', ops: ['example/bff/save'] }, 'instance:app/form', snaps, kinds).candidates, ['instance:app/half', 'instance:bff/bff']);
});
