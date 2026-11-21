import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access, rename as realRename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { database } from '../common.mjs';
import { demoFolder } from '../demo-folder.mjs';

const lockError = () => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM', syscall: 'rename' });
function faultyRename(fault) {
  const calls = [];
  return { calls, rename: async (from, to) => { calls.push(to); if (fault.left > 0) { fault.left -= 1; throw lockError(); } return realRename(from, to); } };
}
const add = name => state => { state.documents.push({ name }); state.events.push({ action: 'added', name }); return { name }; };

test('service database: a transient rename lock is retried; a lasting one fails and leaves the saved data and the lock clean', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cp-service-db-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const file = join(directory, 'documents.json');
  const fault = { left: 2 };
  const files = { ...faultyRename(fault), wait: async () => {}, platform: 'win32', report: () => {} };
  const db = await database(file, { documents: [], receipts: [] }, { files });

  assert.deepEqual(await db.transact(add('first')), { name: 'first' });
  assert.equal(files.calls.length, 3, 'two refusals, then the rename');
  const committed = await readFile(file, 'utf8');
  assert.deepEqual([db.read().revision, JSON.parse(committed).documents.map(item => item.name)], [1, ['first']]);

  fault.left = Infinity;
  await assert.rejects(db.transact(add('second')), error => error.code === 'EPERM' && error.status === undefined, 'the failure is reported, never hidden');
  assert.deepEqual([db.read().revision, db.read().documents.length, db.read().events.length], [1, 1, 1], 'memory still holds the last committed state');
  assert.equal(await readFile(file, 'utf8'), committed, 'the saved file is intact');
  await assert.rejects(access(`${file}.lock`), { code: 'ENOENT' }, 'the write lock was released, so the next write is not blocked');

  fault.left = 0;
  assert.deepEqual(await db.transact(add('second')), { name: 'second' });
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual([saved.revision, saved.documents.map(item => item.name), saved.events.length], [2, ['first', 'second'], 2], 'applied once after the lock cleared');
});

test('demo data folder: a new folder per run under the system temporary directory, unless DEMO_DATA_ROOT says otherwise', async t => {
  const first = await demoFolder('funding', {});
  const second = await demoFolder('funding', {});
  t.after(() => Promise.all([first, second].map(path => rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }))));
  assert.ok(first.startsWith(join(tmpdir(), 'compliance-platform-demos', 'funding')), first);
  assert.notEqual(first, second, 'two runs never share a folder');
  await access(first);
  assert.doesNotMatch(first, /OneDrive/i, 'outside the synced source folder');

  const parent = await mkdtemp(join(tmpdir(), 'cp-demo-root-'));
  t.after(() => rm(parent, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const chosen = await demoFolder('funding', { DEMO_DATA_ROOT: parent }, new Date('2026-11-20T12:00:00.000Z'));
  assert.equal(chosen, join(parent, '2026-11-20T12-00-00-000Z'), 'the override keeps its earlier layout');
});
