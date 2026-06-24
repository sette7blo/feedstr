import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'feedstr-db-'));
process.env.FEEDSTR_DB_STORE = join(dir, 'feedstr.db');

const { getStateValue, setStateValue, getCachedNotes, setCachedNotes, deleteCachedNotes, closeDbForTests } = await import('../src/app/db.js');

test.after(() => {
  closeDbForTests();
  rmSync(dir, { recursive: true, force: true });
});

test('state store round-trips column config', () => {
  assert.equal(getStateValue('columns'), null);
  const columns = [{ id: 'a1', type: 'home', name: 'Home' }];
  setStateValue('columns', columns);
  assert.deepEqual(getStateValue('columns'), columns);
});

test('cached notes are stored per column, newest first, and capped', () => {
  const events = Array.from({ length: 3 }, (_, i) => ({ id: `e${i}`, created_at: i, content: `note ${i}` }));
  const count = setCachedNotes('col1', events);
  assert.equal(count, 3);
  const got = getCachedNotes('col1');
  assert.equal(got.length, 3);
  assert.equal(got[0].id, 'e2'); // newest created_at first
  assert.deepEqual(getCachedNotes('col2'), []);
});

test('cached notes replace the column snapshot and can be deleted', () => {
  setCachedNotes('col1', [{ id: 'x', created_at: 9, content: 'only' }]);
  assert.deepEqual(getCachedNotes('col1').map(e => e.id), ['x']);
  deleteCachedNotes('col1');
  assert.deepEqual(getCachedNotes('col1'), []);
});
