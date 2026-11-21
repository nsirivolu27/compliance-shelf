import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApp } from '../src/server.mjs';

// Sends the path exactly as written, so "../" segments reach the server unnormalized.
function rawGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('frontend files are served from public/ only', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'va-compliance-frontend-'));
  const server = await createApp({ stateFile: join(directory, 'workspace.json') });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  t.after(async () => { await new Promise(r => server.close(r)); await rm(directory, { recursive: true, force: true }); });

  const page = await rawGet(port, '/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /^text\/html/);
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);
  assert.match(page.body, /Compliance Shelf/);

  const script = await rawGet(port, '/js/app.js');
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /^text\/javascript/);
  assert.equal((await rawGet(port, '/styles.css')).status, 200);

  for (const path of ['/package.json', '/src/server.mjs', '/data/demo-cases.json', '/.local/workspace.json', '/../package.json', '/js/../../package.json', '/js/%2e%2e/%2e%2e/package.json', '/js']) {
    assert.equal((await rawGet(port, path)).status, 404, path);
  }
  const posted = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(posted.status, 404);
});
