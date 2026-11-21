import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readVideoTasks } from '../src/video.mjs';
import { createApp } from '../src/server.mjs';

test('optional video connection rejects nonlocal destinations without fetching', async () => {
  let calls = 0;
  const fetcher = () => { calls++; throw new Error('Must not fetch'); };
  assert.equal((await readVideoTasks('', fetcher)).status, 'disabled');
  for (const url of ['https://example.com', 'http://127.0.0.1@evil.test', 'http://localhost/tasks', 'file:///tmp/tasks']) {
    assert.equal((await readVideoTasks(url, fetcher)).status, 'unavailable');
  }
  assert.equal(calls, 0);
});

test('video failures and malformed tasks degrade to unavailable', async () => {
  for (const fetcher of [async () => { throw new Error('offline'); }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ tasks: [{}] }) })]) {
    const result = await readVideoTasks('http://127.0.0.1:8000', fetcher);
    assert.equal(result.status, 'unavailable');
    assert.deepEqual(result.tasks, []);
  }
});

test('video metadata bridges through the platform without disk paths or compliance mutations', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'compliance-video-'));
  const video = createServer((req, res) => {
    assert.equal(req.url, '/tasks');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ tasks: [{ task_id: 'video-1', filename: 'demo.mp4', status: 'completed', updated_at: '2026-11-15T12:00:00Z', video_path: 'private/upload.mp4', result_path: 'private/result.json', error: 'private detail' }] }));
  });
  video.listen(0, '127.0.0.1'); await once(video, 'listening');
  const app = await createApp({ stateFile: join(directory, 'workspace.json'), videoApiUrl: `http://127.0.0.1:${video.address().port}` });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(async () => {
    await Promise.all([new Promise(r => app.close(r)), new Promise(r => video.close(r))]);
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.address().port}`;
  const before = await (await fetch(`${base}/api/workspace`)).json();
  const result = await (await fetch(`${base}/api/video/tasks`)).json();
  assert.equal(result.status, 'connected');
  assert.deepEqual(result.tasks, [{ id: 'video-1', filename: 'demo.mp4', status: 'completed', updatedAt: '2026-11-15T12:00:00Z' }]);
  assert.deepEqual(await (await fetch(`${base}/api/workspace`)).json(), before);
});
