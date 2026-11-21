import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { busyPorts } from '../free-ports.mjs';

test('busyPorts names the ports another program already holds, and only those', async t => {
  const holder = createServer();
  holder.listen(0, '127.0.0.1'); await once(holder, 'listening');
  t.after(() => new Promise(resolve => holder.close(resolve)));
  const taken = holder.address().port;

  // Find a port that is free right now by opening and closing one.
  const probe = createServer();
  probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const free = probe.address().port;
  await new Promise(resolve => probe.close(resolve));

  assert.deepEqual(await busyPorts('127.0.0.1', [free, taken]), [taken]);
  assert.deepEqual(await busyPorts('127.0.0.1', [free]), []);
});
