import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { root, serviceNames } from '../config.mjs';

test('the supervisor starts eight independent processes and shuts them down cleanly', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'compliance-processes-'));
  const env = { ...process.env, PLATFORM_DATA_DIR: directory, WORKSPACE_FILE: join(directory, 'workspace.json'), SERVICE_HOST: '127.0.0.1', VIDEO_API_URL: '' };
  const reservations = [];
  for (const name of serviceNames) {
    const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); reservations.push(server);
    const port = server.address().port;
    env[`${name.toUpperCase()}_PORT`] = String(port);
    if (name !== 'gateway') env[`${name.toUpperCase()}_URL`] = `http://127.0.0.1:${port}`;
  }
  await Promise.all(reservations.map(server => new Promise(resolve => server.close(resolve))));
  const child = spawn(process.execPath, ['services/run.mjs'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  child.stdout.on('data', data => { output = (output + data).slice(-10000); });
  child.stderr.on('data', data => { output = (output + data).slice(-10000); });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(async () => {
    if (child.exitCode === null) {
      if (child.connected) child.send('shutdown', () => {});
      const timer = setTimeout(() => child.kill(), 12000); timer.unref();
      await exited; clearTimeout(timer);
    }
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${env.GATEWAY_PORT}`;
  let healthy = false;
  const deadline = Date.now() + 35000;
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(base + '/api/services', { signal: AbortSignal.timeout(1500) });
      const result = await response.json();
      if (result.status === 'ok' && result.services.length === 7) { healthy = true; break; }
    } catch { /* Supervisor is still starting children. */ }
    await delay(150);
  }
  assert.equal(healthy, true, output);
  const created = await fetch(base + '/api/cases', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'process-smoke' }, body: JSON.stringify({ title: 'Independent-process demo', owner: 'Demo reviewer', note: 'Created through the running service gateway.' }) });
  assert.equal(created.status, 201);
  assert.equal((await (await fetch(base + '/api/dashboard')).json()).counts.cases, 4);
  child.send('shutdown');
  assert.equal(await exited, 0, output);
  for (const name of serviceNames) {
    await assert.rejects(fetch(`http://127.0.0.1:${env[`${name.toUpperCase()}_PORT`]}/health`, { signal: AbortSignal.timeout(500) }), `${name} must stop with its supervisor`);
  }
});
