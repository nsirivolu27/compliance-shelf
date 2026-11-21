import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { configuration } from '../config.mjs';
import { busyPorts } from '../free-ports.mjs';
import { pitchDemoEnvironment, startPitchDemo } from '../pitch-runner.mjs';

const fakeSupervisor = resolve(import.meta.dirname, 'fixtures/fake-supervisor.mjs');
const quiet = { log() {}, error() {} };

// Eight free ports in a row, starting somewhere unlikely to be used.
async function freeGatewayPort() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const start = 20000 + Math.floor(Math.random() * 30000);
    const ports = Array.from({ length: 8 }, (_, index) => start + index);
    if ((await busyPorts('127.0.0.1', ports)).length === 0) return start;
  }
  throw new Error('No free block of eight ports was found');
}

test('PITCH-R1: inherited port, address and host settings cannot redirect the isolated demo', () => {
  const inherited = {
    PATH: 'C:\\Windows', GATEWAY_PORT: '5517', WORKFLOW_PORT: '6000', WORKFLOW_URL: 'http://127.0.0.1:9',
    DOCUMENTS_URL: 'http://127.0.0.1:9', SERVICE_HOST: '0.0.0.0', SERVICE_TOKEN: 'x'.repeat(40),
    SERVICE_TOKEN_FILE: 'C:\\elsewhere\\token', VIDEO_API_URL: 'http://127.0.0.1:8000',
    WORKSPACE_FILE: 'C:\\saved\\workspace.json', PLATFORM_DATA_DIR: 'C:\\saved\\services',
  };
  const folder = join(tmpdir(), 'cp-pitch-env');
  const env = pitchDemoEnvironment(inherited, 4517, folder);
  const config = configuration(env);

  assert.deepEqual(Object.values(config.ports).sort(), [4517, 4518, 4519, 4520, 4521, 4522, 4523, 4524]);
  assert.equal(config.ports.gateway, 4517);
  for (const [name, url] of Object.entries(config.urls)) assert.equal(url, `http://127.0.0.1:${config.ports[name]}`);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.videoApiUrl, '');
  assert.equal(config.states.workflow, resolve(folder, 'workspace.json'));
  assert.equal(config.tokenFile, resolve(folder, 'services', 'service-token'));
  assert.equal(env.SERVICE_TOKEN, undefined, 'the supervisor makes its own token');
  assert.equal(env.PATH, 'C:\\Windows', 'ordinary settings are kept');
  assert.equal(inherited.GATEWAY_PORT, '5517', 'the caller\'s settings are not changed');
});

async function runWith({ seed, crashCode, userStops }, t) {
  const folder = await mkdtemp(join(tmpdir(), 'cp-pitch-runner-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.FAKE_CRASH_CODE;
  if (crashCode) env.FAKE_CRASH_CODE = String(crashCode);
  const demo = await startPitchDemo({ env, gatewayPort: await freeGatewayPort(), folder, supervisor: fakeSupervisor, seed, today: '2026-11-20', output: quiet });
  const seeded = await demo.ready;
  if (userStops) demo.stop();
  return { seeded, code: await demo.exited };
}

test('PITCH-R2: a seed failure keeps exit code 1 even though the supervisor then stops cleanly', async t => {
  const { seeded, code } = await runWith({ seed: async () => { throw new Error('CONTROLLED_SEED_FAILURE'); } }, t);
  assert.equal(seeded, null);
  assert.equal(code, 1);
});

test('a successful run that the user stops exits 0', async t => {
  const { seeded, code } = await runWith({ seed: async () => ({ va: 'DEMO-va', ssa: 'DEMO-ssa' }), userStops: true }, t);
  assert.deepEqual(seeded, { va: 'DEMO-va', ssa: 'DEMO-ssa' });
  assert.equal(code, 0);
});

test('a supervisor that crashes after a good start passes its own exit code on', async t => {
  const { code } = await runWith({ seed: async () => ({ va: 'a', ssa: 'b' }), crashCode: 3 }, t);
  assert.equal(code, 3);
});

test('a failed start names the data folder it kept and where service diagnostics would be', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'cp-pitch-runner-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const env = { ...process.env };
  delete env.FAKE_CRASH_CODE;
  const lines = [];
  const output = { log: line => lines.push(`out ${line}`), error: line => lines.push(`err ${line}`) };
  const demo = await startPitchDemo({ env, gatewayPort: await freeGatewayPort(), folder, supervisor: fakeSupervisor, seed: async () => { throw new Error('CONTROLLED_SEED_FAILURE'); }, today: '2026-11-20', output });
  assert.equal(await demo.ready, null);
  assert.equal(await demo.exited, 1);
  assert.ok(lines.includes(`out Data folder for this run: ${folder}`), 'the folder is printed before anything is seeded');
  assert.ok(lines.includes('err CONTROLLED_SEED_FAILURE'));
  assert.ok(lines.includes(`err Data folder kept for inspection: ${folder}`));
  assert.ok(lines.includes(`err Service diagnostics, if any were recorded: ${join(folder, 'services', 'diagnostics.log')}`));
});
