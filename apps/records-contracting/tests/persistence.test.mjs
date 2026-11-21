import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, rename as realRename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replaceFile, failureRecord, reportFailure, renameRetryDelays, isTransientFileLock } from '../src/lib/persistence.mjs';
import { createStore } from '../src/store.mjs';

// The error Windows gives when another program holds the destination open. Its message carries a full local path.
const lockError = (code = 'EPERM') => Object.assign(
  new Error(`${code}: operation not permitted, rename 'C:\\Users\\someone\\private-folder\\workspace.json.tmp' -> 'C:\\Users\\someone\\private-folder\\workspace.json'`),
  { code, syscall: 'rename', path: 'C:\\Users\\someone\\private-folder\\workspace.json.tmp', dest: 'C:\\Users\\someone\\private-folder\\workspace.json' });

// A rename that fails while `fault.left` is above zero (or forever with Infinity), then does the real rename.
function faultyRename(fault, code = 'EPERM') {
  const calls = [];
  const rename = async (from, to) => {
    calls.push(to);
    if (fault.left > 0) { fault.left -= 1; throw lockError(code); }
    return realRename(from, to);
  };
  return { rename, calls };
}

async function folder(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cp-persistence-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  return directory;
}

test('replaceFile: a transient Windows lock is retried with bounded waits and then the file is replaced', async t => {
  const directory = await folder(t);
  const file = join(directory, 'saved.json');
  await writeFile(file, 'old');
  await writeFile(`${file}.tmp`, 'new');
  const waits = [];
  const { rename, calls } = faultyRename({ left: 2 });
  const reports = [];
  const result = await replaceFile(`${file}.tmp`, file, { rename, wait: async ms => { waits.push(ms); }, platform: 'win32', report: record => reports.push(record) });
  assert.deepEqual([result.retries, calls.length, waits], [2, 3, renameRetryDelays.slice(0, 2)]);
  assert.equal(await readFile(file, 'utf8'), 'new');
  assert.deepEqual(reports.map(({ event, file: name, retries }) => [event, name, retries]), [['rename-retried', 'saved.json', 2]], 'a lock that was waited out is recorded, by file name only');
});

test('replaceFile: a lock that outlasts the retries is thrown as received, and the saved file keeps its content', async t => {
  const directory = await folder(t);
  const file = join(directory, 'saved.json');
  await writeFile(file, 'old');
  await writeFile(`${file}.tmp`, 'new');
  const waits = [];
  const { rename, calls } = faultyRename({ left: Infinity });
  const thrown = await replaceFile(`${file}.tmp`, file, { rename, wait: async ms => { waits.push(ms); }, platform: 'win32', report: () => {} }).then(() => null, error => error);
  assert.equal(thrown.code, 'EPERM');
  assert.equal(thrown.status, undefined, 'it is still an unexpected failure, never a refusal the client could mistake for a rule');
  assert.equal(thrown.renameAttempts, renameRetryDelays.length + 1);
  assert.deepEqual([calls.length, waits], [renameRetryDelays.length + 1, renameRetryDelays], 'bounded: one try and one retry per delay');
  assert.ok(waits.reduce((sum, ms) => sum + ms, 0) <= 1000, 'the retries take about one second at most');
  assert.equal(await readFile(file, 'utf8'), 'old', 'the saved file is intact');
  assert.equal(await readFile(`${file}.tmp`, 'utf8'), 'new', 'nothing was deleted to force the rename');
});

test('replaceFile: other errors, and lock codes on other platforms, are not retried', async t => {
  const directory = await folder(t);
  const file = join(directory, 'saved.json');
  await writeFile(file, 'old');
  await writeFile(`${file}.tmp`, 'new');
  const noWait = async () => { throw new Error('no wait expected'); };
  const full = faultyRename({ left: Infinity }, 'ENOSPC');
  await assert.rejects(replaceFile(`${file}.tmp`, file, { rename: full.rename, wait: noWait, platform: 'win32' }), { code: 'ENOSPC' });
  assert.equal(full.calls.length, 1);
  const linux = faultyRename({ left: Infinity }, 'EPERM');
  await assert.rejects(replaceFile(`${file}.tmp`, file, { rename: linux.rename, wait: noWait, platform: 'linux' }), { code: 'EPERM' });
  assert.equal(linux.calls.length, 1, 'on other systems EPERM is a real permission problem');
  assert.deepEqual(['EPERM', 'EBUSY', 'EACCES', 'ENOENT', 'ENOSPC'].map(code => isTransientFileLock({ code }, 'win32')), [true, true, true, false, false]);
  assert.equal(await readFile(file, 'utf8'), 'old');
});

const caseItem = { id: 'C-1', title: 'Synthetic case', evidence: [], records: [] };
const rename = (state, title) => { state.cases[0].title = title; return { title }; };

test('store: a save that hits a transient lock still commits once, with state, file and receipt in step', async t => {
  const directory = await folder(t);
  const file = join(directory, 'workspace.json');
  const fault = { left: 2 };
  const store = await createStore(file, [caseItem], { files: { ...faultyRename(fault), wait: async () => {}, platform: 'win32', report: () => {} } });
  const result = await store.mutate('context', 'C-1', state => rename(state, 'First title'), { idempotency: { key: 'k1', fingerprint: 'f1' } });
  assert.deepEqual(result, { title: 'First title' });
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual([store.read().revision, saved.revision, saved.events.length, saved.requests.length, saved.cases[0].title], [1, 1, 1, 1, 'First title']);
});

test('store: a failed save changes nothing, is reported as a failure, and the same request then applies exactly once', async t => {
  const directory = await folder(t);
  const file = join(directory, 'workspace.json');
  const fault = { left: 0 };
  const store = await createStore(file, [caseItem], { files: { ...faultyRename(fault), wait: async () => {}, platform: 'win32', report: () => {} } });
  await store.mutate('context', 'C-1', state => rename(state, 'First title'), { idempotency: { key: 'k1', fingerprint: 'f1' } });
  const committed = await readFile(file, 'utf8');

  fault.left = Infinity;
  const request = { idempotency: { key: 'k2', fingerprint: 'f2' }, expectedRevision: 1 };
  await assert.rejects(store.mutate('context', 'C-1', state => rename(state, 'Second title'), request), error => error.code === 'EPERM' && error.status === undefined);
  const after = store.read();
  assert.deepEqual([after.revision, after.events.length, after.cases[0].title, after.cases[0].revision], [1, 1, 'First title', 1], 'memory still holds the last committed state');
  assert.equal(await readFile(file, 'utf8'), committed, 'the saved file is byte for byte the last committed state');
  assert.equal(JSON.parse(committed).requests.some(receipt => receipt.key === 'k2'), false, 'no receipt for a save that failed');

  // The lock clears. The client retries the same request with the same key, as the error message asks.
  fault.left = 0;
  assert.deepEqual(await store.mutate('context', 'C-1', state => rename(state, 'Second title'), request), { title: 'Second title' });
  assert.deepEqual(await store.mutate('context', 'C-1', state => rename(state, 'Second title'), request), { title: 'Second title' }, 'a repeat returns the receipt');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual([saved.revision, saved.events.length, saved.requests.map(receipt => receipt.key), saved.cases[0].revision], [2, 2, ['k1', 'k2'], 2], 'applied exactly once');
  assert.deepEqual(saved.events.map(event => event.workspaceRevision), [1, 2], 'the event history has no gap and no duplicate');
});

test('failure record: a file error keeps its code, system call and file name, and no local path or message', () => {
  const record = failureRecord(lockError(), { service: 'workflow', method: 'POST', path: '/api/cases/DEMO-1/records', requestId: 'r-1' });
  assert.deepEqual([record.service, record.method, record.path, record.code, record.syscall, record.file, record.target], ['workflow', 'POST', '/api/cases/DEMO-1/records', 'EPERM', 'rename', 'workspace.json.tmp', 'workspace.json']);
  assert.equal(record.message, undefined);
  assert.doesNotMatch(JSON.stringify(record), /someone|private-folder/);
  const unexpected = failureRecord(new TypeError('Cannot read properties of undefined'), { service: 'documents' });
  assert.deepEqual([unexpected.name, unexpected.message, unexpected.code], ['TypeError', 'Cannot read properties of undefined', undefined]);
  assert.match(unexpected.where, /persistence\.test\.mjs/);
  assert.doesNotMatch(unexpected.where, /[\\/]/, 'the frame names a file, not a folder');
  assert.deepEqual(Object.keys(record).sort(), ['at', 'code', 'file', 'message', 'method', 'name', 'path', 'renameAttempts', 'requestId', 'service', 'syscall', 'target', 'where'], 'nothing else can be recorded');
});

const diagnosticPaths = [
  'C:\\Users\\someone\\private-folder\\workspace.json',
  '/home/someone/private-folder/workspace.json',
  'C:\\Users/someone\\private-folder/workspace.json',
  '\\\\private-server\\private-share\\someone\\workspace.json',
];

test('failure record: Windows, POSIX, mixed and UNC paths never expose folders on any host', () => {
  for (const path of diagnosticPaths) {
    const record = failureRecord(Object.assign(lockError(), { path: `${path}.tmp`, dest: path }));
    assert.deepEqual([record.file, record.target], ['workspace.json.tmp', 'workspace.json']);
    assert.doesNotMatch(JSON.stringify(record), /someone|private-folder|private-server|private-share|[\\/]/);
    assert.equal(record.message, undefined);
  }
});

test('replaceFile: successful retry diagnostics strip folders from every supported path style', async () => {
  for (const destination of diagnosticPaths) {
    let attempts = 0;
    const reports = [];
    const result = await replaceFile(`${destination}.tmp`, destination, {
      platform: 'win32', delays: [0], wait: async () => {},
      rename: async () => { if (++attempts === 1) throw lockError(); },
      report: record => reports.push(record),
    });
    assert.equal(result.retries, 1);
    assert.deepEqual(reports.map(({ event, file, retries }) => [event, file, retries]), [['rename-retried', 'workspace.json', 1]]);
    assert.doesNotMatch(JSON.stringify(reports), /someone|private-folder|private-server|private-share|[\\/]/);
  }
});

test('failure report: it reaches the error stream and the diagnostics file, and never throws', async t => {
  const directory = await folder(t);
  const file = join(directory, 'services', 'diagnostics.log');
  const lines = [];
  await reportFailure({ service: 'workflow', code: 'EPERM' }, { file, log: line => lines.push(line) });
  await reportFailure({ service: 'documents', code: 'EBUSY' }, { file, log: () => { throw new Error('stream closed'); } });
  assert.deepEqual(lines, ['[diagnostic] {"service":"workflow","code":"EPERM"}']);
  assert.deepEqual((await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line).service), ['workflow', 'documents']);
  // A diagnostics file that cannot be written is not allowed to hide the failure being reported.
  await reportFailure({ service: 'workflow' }, { file: join(file, 'not-a-folder', 'x.log'), log: () => {} });
});
